import { currentSalt, type Balance } from '../near/contract';
import * as tx from '../near/tx';
import { useWallet } from '../near/wallet';
import { randomNonce, service, ServiceUnavailable, toBase64, type CheckinResult, type SignedRequest } from './service';

export const SIGN_RECIPIENT = 'deadswitch';

/** Asks the wallet for a free signed message; null if it can't sign messages. */
export async function signRequest(
  wallet: ReturnType<typeof useWallet>, purpose: 'check-in' | 'settings',
): Promise<SignedRequest | null> {
  const nonce = randomNonce();
  const message = `Deadswitch ${purpose} for ${wallet.accountId} at ${new Date().toISOString()}`;
  const signed = await wallet.signMessage(message, SIGN_RECIPIENT, nonce);
  return signed ? { ...signed, message, recipient: SIGN_RECIPIENT, nonce: toBase64(nonce) } : null;
}

export type CheckinOutcome =
  | { kind: 'free'; result: CheckinResult }
  | { kind: 'paid'; hash: string }
  | { kind: 'needs-paid'; reason: string };

/**
 * Website check-in. First a free signed message that the reminder service turns into
 * `operator_check_in`. If that can't work, returns `needs-paid` so the UI can explain
 * the small fee before calling `ping()` with `checkinWithPing`.
 */
export async function checkinFree(wallet: ReturnType<typeof useWallet>): Promise<CheckinOutcome> {
  const auth = await signRequest(wallet, 'check-in');
  if (!auth) return { kind: 'needs-paid', reason: 'Your wallet can’t sign messages.' };
  try {
    const result = await service.walletCheckin(auth);
    /* "Too soon" means you were checked in a moment ago: no reason to pay for another one. */
    if (result.status !== 'operator_off') return { kind: 'free', result };
    return { kind: 'needs-paid', reason: 'Free check-ins are turned off in your settings (“Let reminders check me in”).' };
  } catch (e) {
    if (e instanceof ServiceUnavailable) return { kind: 'needs-paid', reason: 'The reminder service isn’t reachable right now.' };
    throw e;
  }
}

export async function checkinWithPing(wallet: ReturnType<typeof useWallet>) {
  const [hash] = await wallet.send([tx.ping()]);
  return hash;
}

/** One `send_now` (panic) or `sweep` (heir) per token with a balance, each with the current salt. */
export async function payoutAll(wallet: ReturnType<typeof useWallet>, balances: Balance[], kind: 'send_now' | 'sweep') {
  const salt = await currentSalt();
  const txs = balances.filter((b) => BigInt(b.amount) > 0n)
    .map((b) => (kind === 'send_now' ? tx.sendNow(b.id, b.amount, salt) : tx.sweep(b.id, b.amount, salt)));
  if (!txs.length) throw new Error('There is nothing to send: the NEAR Intents account is empty.');
  return wallet.send(txs);
}

