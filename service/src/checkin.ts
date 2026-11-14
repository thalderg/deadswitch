import { config } from './config';
import { db, recordCheckin, sha256 } from './db';
import { getStatus, nsToMs, sendTx, TxError, verifySigned, type SignedRequest } from './near';

export type CheckinResult =
  | { status: 'checked_in'; txHash: string; dryRun?: boolean; deadlineMs: number }
  | { status: 'too_soon'; deadlineMs: number }
  | { status: 'operator_off' }
  | { status: 'closed' };

/** Calls `operator_check_in` and turns the contract's answers into a result. */
export async function operatorCheckin(source: 'website' | 'email' | 'telegram'): Promise<CheckinResult> {
  try {
    const tx = await sendTx('operator_check_in', {}, 30);
    recordCheckin(config.ownerId, source, tx);
    const s = await getStatus();
    /* In DRY_RUN nothing changed on chain: report the deadline a real check-in would give. */
    const deadlineMs = tx === 'dry-run' ? Date.now() + s.timeout_secs * 1000 : nsToMs(s.deadline_ns);
    return { status: 'checked_in', txHash: tx, dryRun: tx === 'dry-run' || undefined, deadlineMs };
  } catch (e) {
    const msg = e instanceof TxError ? e.message : String(e);
    if (/Too soon/i.test(msg)) return { status: 'too_soon', deadlineMs: nsToMs((await getStatus()).deadline_ns) };
    if (/check-ins are closed/i.test(msg)) return { status: 'closed' };
    if (/Only the check-in operator/i.test(msg)) return { status: 'operator_off' };
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Website requests signed by the owner's wallet (NEP-413)             */
/* ------------------------------------------------------------------ */

const MAX_AGE_MS = 5 * 60_000;

/** Checks a signed request from the website: recipient, owner, purpose, freshness, unused nonce, signature. */
export async function checkSigned(auth: SignedRequest, purpose: 'check-in' | 'settings'): Promise<void> {
  if (!auth || typeof auth.message !== 'string') throw new HttpError(400, 'Missing signed message.');
  if (auth.recipient !== 'deadswitch') throw new HttpError(401, 'The message was signed for another app.');
  if (auth.accountId !== config.ownerId) throw new HttpError(403, 'Only the owner of this plan can do this.');
  const m = auth.message.match(/^Deadswitch (check-in|settings) for (\S+) at (\S+)$/);
  if (!m || m[1] !== purpose || m[2] !== config.ownerId) throw new HttpError(401, 'The signed message isn’t the one we expected.');
  const at = Date.parse(m[3]);
  if (!Number.isFinite(at) || Math.abs(Date.now() - at) > MAX_AGE_MS) throw new HttpError(401, 'The signed message is too old. Try again.');
  const nonce = Buffer.from(auth.nonce ?? '', 'base64');
  if (nonce.length !== 32) throw new HttpError(400, 'The nonce must be 32 bytes.');
  try {
    await verifySigned(auth);
  } catch (e) {
    throw new HttpError(401, `The signature couldn’t be verified: ${(e as Error).message}`);
  }
  /* Single use: a replayed message is refused. Old nonces are dropped after a day. */
  db.prepare('DELETE FROM nonces WHERE created_at < ?').run(Date.now() - 86_400_000);
  const key = sha256(auth.nonce);
  const ok = db.prepare('INSERT OR IGNORE INTO nonces (nonce, created_at) VALUES (?, ?)').run(key, Date.now());
  if (!ok.changes) throw new HttpError(401, 'This signed message was already used.');
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/* ------------------------------------------------------------------ */
/* One-time check-in links from reminders                              */
/* ------------------------------------------------------------------ */

export type TokenState = 'valid' | 'used' | 'expired' | 'unknown';

export function tokenState(token: string): TokenState {
  const row = db.prepare('SELECT expires_at, used_at FROM checkin_tokens WHERE hash = ?').get(sha256(token)) as { expires_at: number; used_at: number | null } | undefined;
  if (!row) return 'unknown';
  if (row.used_at) return 'used';
  return row.expires_at <= Date.now() ? 'expired' : 'valid';
}

/** Uses a one-time link (email or Telegram button). Marks it used only when it worked. */
export async function checkinWithToken(token: string, source: 'email' | 'telegram'): Promise<CheckinResult | { status: TokenState }> {
  const state = tokenState(token);
  if (state !== 'valid') return { status: state };
  const result = await operatorCheckin(source);
  if (result.status === 'checked_in' || result.status === 'too_soon') {
    db.prepare('UPDATE checkin_tokens SET used_at = ? WHERE hash = ?').run(Date.now(), sha256(token));
  }
  return result;
}
