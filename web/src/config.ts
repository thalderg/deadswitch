const env = import.meta.env;

export const NETWORK = (env.VITE_NETWORK ?? 'mainnet') as 'mainnet' | 'testnet';
export const CONTRACT_ID: string = env.VITE_CONTRACT_ID ?? 'deadswitch.thalderg.near';
export const OPERATOR_ID: string = env.VITE_OPERATOR_ID ?? 'checkin.thalderg.near';
export const SERVICE_URL: string = (env.VITE_SERVICE_URL ?? 'http://localhost:8787').replace(/\/$/, '');
export const RPC_URL: string = env.VITE_RPC_URL ?? 'https://free.rpc.fastnear.com';
/** Tokens to show even if the owner's account doesn't list them yet. */
export const EXTRA_TOKENS: string[] = (env.VITE_TOKENS ?? 'nep141:wrap.near')
  .split(',').map((t: string) => t.trim()).filter(Boolean);

export const INTENTS_ID = 'intents.near';
export const MPC_ID = 'v1.signer';
export const ESTATE_PATH = 'estate:intents';
export const EXPLORER_TX = 'https://nearblocks.io/txns/';

/** Gas in yocto-units of gas, as the wallet expects strings. */
export const GAS_30 = '30000000000000';
export const GAS_300 = '300000000000000';
