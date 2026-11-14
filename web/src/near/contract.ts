import { CONTRACT_ID, ESTATE_PATH, EXTRA_TOKENS, INTENTS_ID, MPC_ID } from '../config';
import { view } from './rpc';

export interface Heir { account_id: string; share_bps: number }

export interface Status {
  owner: string;
  heirs: Heir[];
  timeout_secs: number;
  last_ping_ns: string;
  deadline_ns: string;
  now_ns: string;
  triggered: boolean;
  estate_path: string;
  estate_public_key: string | null;
  timer_enabled: boolean;
  panic_enabled: boolean;
  change_delay_secs: number;
  pending_testament: { heirs: Heir[]; effective_ns: string } | null;
  pending_modes: { timer_enabled: boolean; panic_enabled: boolean; effective_ns: string } | null;
  checkin_operator: string | null;
  pending_operator: { account_id: string; effective_ns: string } | null;
  operator_min_interval_secs: number;
  last_operator_checkin_ns: string;
}

export const getStatus = () => view<Status>(CONTRACT_ID, 'status');

export const previewSweep = (amount: string) =>
  view<{ account_id: string; amount: string }[]>(CONTRACT_ID, 'preview_sweep', { amount });

/** The estate key the contract can sign with (derived by the MPC network). */
export const derivedEstateKey = () =>
  view<string>(MPC_ID, 'derived_public_key', { path: ESTATE_PATH, predecessor: CONTRACT_ID, domain_id: 1 });

export const hasPublicKey = (accountId: string, publicKey: string) =>
  view<boolean>(INTENTS_ID, 'has_public_key', { account_id: accountId, public_key: publicKey });

export const currentSalt = () => view<string>(INTENTS_ID, 'current_salt');

export interface TokenInfo { id: string; symbol: string; decimals: number }
export interface Balance extends TokenInfo { amount: string }

const metaCache = new Map<string, TokenInfo>();

/** Name and decimals for an Intents token id such as `nep141:wrap.near`. */
export async function tokenInfo(id: string): Promise<TokenInfo> {
  const cached = metaCache.get(id);
  if (cached) return cached;
  let info: TokenInfo = { id, symbol: id.replace(/^nep\d+:/, ''), decimals: 0 };
  if (id.startsWith('nep141:')) {
    try {
      const m = await view<{ symbol: string; decimals: number }>(id.slice(7), 'ft_metadata');
      info = { id, symbol: m.symbol === 'wNEAR' ? 'NEAR' : m.symbol, decimals: m.decimals };
    } catch { /* keep the fallback */ }
  }
  metaCache.set(id, info);
  return info;
}

/** Balances of `accountId` in NEAR Intents for the given tokens. */
export async function intentsBalancesOf(accountId: string, tokens: TokenInfo[]): Promise<Balance[]> {
  const amounts = await view<string[]>(INTENTS_ID, 'mt_batch_balance_of', { account_id: accountId, token_ids: tokens.map((t) => t.id) });
  return tokens.map((t, i) => ({ ...t, amount: amounts[i] ?? '0' }));
}

/** Every token the owner holds in NEAR Intents, plus the configured ones. */
export async function intentsBalances(accountId: string): Promise<Balance[]> {
  let ids: string[] = [];
  try {
    const owned = await view<{ token_id: string }[]>(INTENTS_ID, 'mt_tokens_for_owner', { account_id: accountId });
    ids = owned.map((t) => t.token_id);
  } catch { /* fall back to the configured list */ }
  for (const t of EXTRA_TOKENS) if (!ids.includes(t)) ids.push(t);
  const amounts = await view<string[]>(INTENTS_ID, 'mt_batch_balance_of', { account_id: accountId, token_ids: ids });
  const infos = await Promise.all(ids.map(tokenInfo));
  return infos.map((info, i) => ({ ...info, amount: amounts[i] ?? '0' }));
}
