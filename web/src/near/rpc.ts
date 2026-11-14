import { RPC_URLS } from '../config';

let id = 0;
/** Index of the endpoint that last worked; we stay on it until it fails. */
let current = 0;

class RpcHttpError extends Error {}

async function callOne<T>(url: string, method: string, params: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  if (!res.ok) throw new RpcHttpError(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) {
    /* Rate limits and server trouble: try another endpoint. Anything else is a real answer. */
    if (body.error.code === -429 || body.error.code === 429 || /rate limit/i.test(JSON.stringify(body.error))) throw new RpcHttpError('rate limited');
    throw new Error(body.error.data ?? body.error.message ?? 'NEAR RPC error');
  }
  if (body.result?.error) throw new Error(body.result.error);
  return body.result as T;
}

/** One RPC call, moving to the next endpoint when one is down or rate-limited. */
async function rpc<T>(method: string, params: unknown): Promise<T> {
  let last: unknown;
  for (let i = 0; i < RPC_URLS.length; i++) {
    const idx = (current + i) % RPC_URLS.length;
    try {
      const r = await callOne<T>(RPC_URLS[idx], method, params);
      current = idx;
      return r;
    } catch (e) {
      if (!(e instanceof RpcHttpError) && !(e instanceof TypeError)) throw e;   // TypeError = network failure
      last = e;
    }
  }
  throw new Error(`The NEAR network didn’t answer (${(last as Error)?.message ?? 'no endpoint'}). Try again in a moment.`);
}

function toBase64(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

/** Calls a view method and parses its JSON result. */
export async function view<T>(contract: string, method: string, args: object = {}): Promise<T> {
  const r = await rpc<{ result: number[] }>('query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: contract,
    method_name: method,
    args_base64: toBase64(JSON.stringify(args)),
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T;
}

/** True if the account exists on chain. */
export async function accountExists(accountId: string): Promise<boolean> {
  try {
    await rpc('query', { request_type: 'view_account', finality: 'final', account_id: accountId });
    return true;
  } catch {
    return false;
  }
}
