import { RPC_URL } from '../config';

let id = 0;

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  if (!res.ok) throw new Error(`The NEAR network didn't answer (HTTP ${res.status}). Try again in a moment.`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.data ?? body.error.message ?? 'NEAR RPC error');
  if (body.result?.error) throw new Error(body.result.error);
  return body.result as T;
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
