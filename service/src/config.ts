/* Configuration from service/.env (loaded by `tsx --env-file`). Secrets are never logged. */

const env = process.env;
const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  network: env.NETWORK ?? 'mainnet',
  contractId: env.CONTRACT_ID ?? 'deadswitch.thalderg.near',
  ownerId: env.OWNER_ID ?? 'thalderg.near',
  operatorId: env.OPERATOR_ACCOUNT_ID ?? 'checkin.thalderg.near',
  operatorKey: env.OPERATOR_PRIVATE_KEY ?? '',
  resendKey: env.RESEND_API_KEY ?? '',
  emailFrom: env.EMAIL_FROM ?? '',
  telegramToken: env.TELEGRAM_BOT_TOKEN ?? '',
  publicBaseUrl: (env.PUBLIC_BASE_URL ?? 'http://localhost:8787').replace(/\/$/, ''),
  siteUrl: (env.SITE_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  rpcUrl: env.RPC_URL ?? 'https://free.rpc.fastnear.com',
  tokens: list(env.TOKENS ?? 'nep141:wrap.near'),
  demoOffsets: list(env.DEMO_REMINDER_OFFSETS_SECONDS).map(Number).filter((n) => n > 0),
  dryRun: (env.DRY_RUN ?? 'true').toLowerCase() !== 'false',
  port: Number(env.PORT ?? 8787),
  intentsId: 'intents.near',
};

/** A one-line summary for the startup log (no secrets). */
export function describeConfig(): string {
  return [
    `network=${config.network}`, `contract=${config.contractId}`, `owner=${config.ownerId}`, `operator=${config.operatorId}`,
    `operator key ${config.operatorKey ? 'set' : 'MISSING'}`, `email ${config.resendKey && config.emailFrom ? 'on' : 'off'}`,
    `telegram ${config.telegramToken ? 'on' : 'off'}`, `tokens=${config.tokens.join('+')}`,
    config.demoOffsets.length ? `DEMO offsets=${config.demoOffsets.join(',')}s` : 'real schedule',
    config.dryRun ? 'DRY_RUN (no transactions are sent)' : 'LIVE (transactions are sent)',
  ].join(' · ');
}
