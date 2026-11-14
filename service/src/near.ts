import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPairSigner } from 'near-api-js';
import { verifyMessage } from 'near-api-js/nep413';
import { config } from './config';
import { log } from './log';

/* Several public endpoints: a rate-limited or failing one hands over to the next. */
export const provider = new FailoverRpcProvider(
  config.rpcUrls.map((url) => new JsonRpcProvider({ url }, { retries: 2, wait: 400, backoff: 2 })),
) as unknown as JsonRpcProvider;

export interface Heir { account_id: string; share_bps: number }
export interface Status {
  owner: string; heirs: Heir[]; timeout_secs: number; last_ping_ns: string; deadline_ns: string; now_ns: string;
  triggered: boolean; estate_public_key: string | null; timer_enabled: boolean; panic_enabled: boolean;
  change_delay_secs: number; checkin_operator: string | null; operator_min_interval_secs: number; last_operator_checkin_ns: string;
}

export const nsToMs = (ns: string) => Number(BigInt(ns) / 1_000_000n);

async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as T;
}

export const getStatus = () => view<Status>(config.contractId, 'status');
export const currentSalt = () => view<string>(config.intentsId, 'current_salt');
export const previewSweep = (amount: string) => view<{ account_id: string; amount: string }[]>(config.contractId, 'preview_sweep', { amount });

/** The owner's tokens in NEAR Intents (listed ones plus TOKENS) with balances. */
export async function balances(accountId: string): Promise<{ id: string; amount: string }[]> {
  let ids: string[] = [];
  try { ids = (await view<{ token_id: string }[]>(config.intentsId, 'mt_tokens_for_owner', { account_id: accountId })).map((t) => t.token_id); } catch { /* use TOKENS */ }
  for (const t of config.tokens) if (!ids.includes(t)) ids.push(t);
  const amounts = await view<string[]>(config.intentsId, 'mt_batch_balance_of', { account_id: accountId, token_ids: ids });
  return ids.map((id, i) => ({ id, amount: amounts[i] ?? '0' }));
}

const metaCache = new Map<string, { symbol: string; decimals: number }>();
export async function tokenMeta(id: string) {
  if (metaCache.has(id)) return metaCache.get(id)!;
  let m = { symbol: id.replace(/^nep\d+:/, ''), decimals: 0 };
  if (id.startsWith('nep141:')) {
    try { const r = await view<{ symbol: string; decimals: number }>(id.slice(7), 'ft_metadata'); m = { symbol: r.symbol === 'wNEAR' ? 'NEAR' : r.symbol, decimals: r.decimals }; } catch { /* fallback */ }
  }
  metaCache.set(id, m);
  return m;
}

/** The operator account's NEAR balance, in NEAR. */
export async function operatorBalanceNear(): Promise<number> {
  const acc = new Account(config.operatorId, provider);
  const yocto = await acc.getBalance();
  return Number(yocto / 10n ** 20n) / 10_000;
}

/* ------------------------------------------------------------------ */
/* The single function every transaction goes through.                 */
/* ------------------------------------------------------------------ */

export class TxError extends Error {}

let operator: Account | null = null;
function operatorAccount(): Account {
  if (!config.operatorKey) throw new TxError('OPERATOR_PRIVATE_KEY is not set in service/.env');
  operator ??= new Account(config.operatorId, provider, KeyPairSigner.fromSecretKey(config.operatorKey as never));
  return operator;
}

/**
 * Sends one function call from the check-in operator and returns the transaction hash.
 * With DRY_RUN=true it only logs and returns "dry-run". Contract panics become TxError
 * with the panic message (e.g. "Too soon: …").
 */
export async function sendTx(methodName: string, args: object, tgas: number): Promise<string> {
  const what = `${config.operatorId} → ${config.contractId}.${methodName}(${JSON.stringify(args)}) ${tgas} Tgas`;
  if (config.dryRun) { log.info(`DRY_RUN, not sent: ${what}`); return 'dry-run'; }
  log.info(`Sending: ${what}`);
  try {
    const res = await operatorAccount().callFunctionRaw({
      contractId: config.contractId, methodName, args, gas: BigInt(tgas) * 10n ** 12n, deposit: 0n, waitUntil: 'FINAL',
    } as never);
    const r = res as unknown as { transaction: { hash: string }; status?: { Failure?: unknown } };
    if (r.status && 'Failure' in r.status) throw new TxError(panicText(r.status.Failure));
    log.info(`Sent ${methodName}: tx ${r.transaction.hash}`);
    return r.transaction.hash;
  } catch (e) {
    const err = e instanceof TxError ? e : new TxError(panicText(e));
    log.warn(`${methodName} failed: ${err.message}`);
    throw err;
  }
}

function panicText(x: unknown): string {
  const s = typeof x === 'string' ? x : x instanceof Error ? x.message : JSON.stringify(x);
  const m = s.match(/Smart contract panicked: ([^"\\]+)/);
  return m ? m[1].trim() : s.slice(0, 300);
}

/* ------------------------------------------------------------------ */
/* NEP-413 signed messages from the website                            */
/* ------------------------------------------------------------------ */

export interface SignedRequest { accountId: string; publicKey: string; signature: string; message: string; recipient: string; nonce: string }

/** Verifies the signature and that the key is a full-access key of the account (via RPC). */
export async function verifySigned(auth: SignedRequest, rpc: typeof provider = provider): Promise<void> {
  const sig = auth.signature.startsWith('ed25519:') ? null : Buffer.from(auth.signature, 'base64');
  if (!sig || sig.length !== 64) throw new Error('The signature is not in the expected format.');
  await verifyMessage({
    signerAccountId: auth.accountId,
    signerPublicKey: auth.publicKey,
    payload: { message: auth.message, recipient: auth.recipient, nonce: Buffer.from(auth.nonce, 'base64') },
    signature: sig,
    provider: rpc,
  });
}
