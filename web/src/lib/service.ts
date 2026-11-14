import { SERVICE_URL } from '../config';
import type { SignedMessage } from '../near/wallet';

/** What the website sends with every request that needs the owner's approval (NEP-413). */
export interface SignedRequest extends SignedMessage {
  message: string;
  recipient: string;
  nonce: string;   // base64 of 32 random bytes
}

export interface ServiceSettings {
  email: string | null;          // masked, e.g. "g•••@gmail.com"
  emailEnabled: boolean;
  telegramLinked: boolean;
  telegramEnabled: boolean;
  notifyHeirs: boolean;
  heirContacts: Record<string, string>;   // account -> contact shown masked
  lastCheckin: { source: 'website' | 'email' | 'telegram' | 'wallet'; atMs: number } | null;
  nextReminderMs: number | null;
}

export type CheckinResult =
  | { status: 'checked_in'; txHash?: string; dryRun?: boolean; deadlineMs: number }
  | { status: 'too_soon'; deadlineMs: number }
  | { status: 'operator_off' }
  | { status: 'closed' };

export class ServiceUnavailable extends Error {
  constructor() { super('The reminder service is not reachable right now.'); }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(SERVICE_URL + path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  } catch {
    throw new ServiceUnavailable();
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `The reminder service answered with an error (${res.status}).`);
  return body as T;
}

export interface PayoutRecord { deadlineMs: number; tokenId: string; tx: string; payouts: { account_id: string; amount: string }[] }

export const service = {
  payouts: () => req<{ payouts: PayoutRecord[] }>('/api/payouts'),
  settings: (owner: string) => req<ServiceSettings>(`/api/settings?owner=${encodeURIComponent(owner)}`),
  saveSettings: (auth: SignedRequest, patch: Partial<Pick<ServiceSettings, 'emailEnabled' | 'telegramEnabled' | 'notifyHeirs' | 'heirContacts'>>) =>
    req<ServiceSettings>('/api/settings', { method: 'POST', body: JSON.stringify({ auth, patch }) }),
  emailStart: (auth: SignedRequest, email: string) =>
    req<{ ok: true }>('/api/email/start', { method: 'POST', body: JSON.stringify({ auth, email }) }),
  emailVerify: (auth: SignedRequest, code: string) =>
    req<ServiceSettings>('/api/email/verify', { method: 'POST', body: JSON.stringify({ auth, code }) }),
  telegramLink: (auth: SignedRequest) =>
    req<{ url: string }>('/api/telegram/link', { method: 'POST', body: JSON.stringify({ auth }) }),
  walletCheckin: (auth: SignedRequest) =>
    req<CheckinResult>('/api/checkin/wallet', { method: 'POST', body: JSON.stringify({ auth }) }),
};

export function randomNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
