import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomInt } from 'node:crypto';
import { config } from './config';
import { db, getSettings, lastCheckin, sha256, updateSettings } from './db';
import { checkinWithToken, checkSigned, HttpError, operatorCheckin, tokenState, usedVia } from './checkin';
import { getStatus } from './near';
import { scheduleFor } from './scheduler';
import { emailEnabled, sendEmail } from './email';
import { linkUrl, telegramEnabled } from './telegram';
import { escapeHtml, humanDuration, maskEmail, utcDateTime } from './format';
import { page } from './pages';
import { log } from './log';

/* ---------------- helpers ---------------- */

function allowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  if (origin === config.siteUrl || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return origin;
  return null;
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type === 'application/json' ? 'application/json; charset=utf-8' : `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : String(body));
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 64_000) throw new HttpError(413, 'Request too large.'); chunks.push(c as Buffer); }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  if ((req.headers['content-type'] ?? '').includes('application/json')) {
    try { return JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON.'); }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

/* ---------------- settings for the web app ---------------- */

async function settingsView(owner: string) {
  const st = getSettings(owner);
  let nextReminderMs: number | null = null;
  try {
    const s = await getStatus();
    const { times, lastScheduled } = scheduleFor(s);
    nextReminderMs = times.find((t) => t > Date.now() && (lastScheduled === null || t > lastScheduled)) ?? null;
  } catch { /* chain not reachable: leave it out */ }
  const lc = lastCheckin(owner);
  const contacts = JSON.parse(st.heir_contacts) as Record<string, string>;
  return {
    email: st.email ? maskEmail(st.email) : null,
    emailEnabled: !!st.email_enabled && emailEnabled(),
    telegramLinked: !!st.tg_chat_id,
    telegramEnabled: !!st.tg_enabled && telegramEnabled(),
    notifyHeirs: !!st.notify_heirs,
    heirContacts: Object.fromEntries(Object.entries(contacts).map(([k, v]) => [k, v.includes('@') && !v.startsWith('@') ? maskEmail(v) : v])),
    lastCheckin: lc ? { source: lc.source, atMs: lc.at_ms } : null,
    nextReminderMs,
  };
}

/* ---------------- routes ---------------- */

type Handler = (req: IncomingMessage, res: ServerResponse, m: RegExpMatchArray) => Promise<void>;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, path: RegExp, h: Handler) => routes.push([method, path, h]);

route('GET', /^\/api\/health$/, async (_q, res) => send(res, 200, { ok: true, dryRun: config.dryRun }));

/* The plan's payouts the service carried out (public: they're on-chain anyway). */
route('GET', /^\/api\/payouts$/, async (_q, res) => {
  const rows = db.prepare("SELECT deadline_ms, token_id, tx, payouts FROM sweeps WHERE tx IS NOT NULL AND tx != 'dry-run' ORDER BY deadline_ms DESC")
    .all() as { deadline_ms: number; token_id: string; tx: string; payouts: string }[];
  send(res, 200, { payouts: rows.map((r) => ({ deadlineMs: r.deadline_ms, tokenId: r.token_id, tx: r.tx, payouts: JSON.parse(r.payouts ?? '[]') })) });
});

route('GET', /^\/api\/settings$/, async (req, res) => {
  const owner = new URL(req.url!, 'http://x').searchParams.get('owner') ?? config.ownerId;
  if (owner !== config.ownerId) throw new HttpError(404, 'This service only handles one plan.');
  send(res, 200, await settingsView(owner));
});

route('POST', /^\/api\/settings$/, async (req, res) => {
  const { auth, patch } = await readBody(req);
  await checkSigned(auth, 'settings');
  const p: Parameters<typeof updateSettings>[1] = {};
  if (typeof patch?.emailEnabled === 'boolean') p.email_enabled = patch.emailEnabled ? 1 : 0;
  if (typeof patch?.telegramEnabled === 'boolean') p.tg_enabled = patch.telegramEnabled ? 1 : 0;
  if (typeof patch?.notifyHeirs === 'boolean') p.notify_heirs = patch.notifyHeirs ? 1 : 0;
  if (patch?.heirContacts && typeof patch.heirContacts === 'object') {
    const current = JSON.parse(getSettings(config.ownerId).heir_contacts) as Record<string, string>;
    for (const [k, v] of Object.entries(patch.heirContacts)) if (typeof v === 'string' && v.trim().length <= 200) current[k] = v.trim();
    p.heir_contacts = JSON.stringify(current);
  }
  updateSettings(config.ownerId, p);
  send(res, 200, await settingsView(config.ownerId));
});

route('POST', /^\/api\/email\/start$/, async (req, res) => {
  const { auth, email } = await readBody(req);
  await checkSigned(auth, 'settings');
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new HttpError(400, 'That doesn’t look like an email address.');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  db.prepare('INSERT OR REPLACE INTO email_codes (owner, email, code_hash, expires_at, tries) VALUES (?, ?, ?, ?, 0)')
    .run(config.ownerId, email.trim(), sha256(code), Date.now() + 15 * 60_000);
  await sendEmail(email.trim(), 'Your Deadswitch code',
    `Your code is ${code}. It’s valid for 15 minutes.\n\nIf you didn’t ask for it, you can ignore this email.`);
  send(res, 200, { ok: true });
});

route('POST', /^\/api\/email\/verify$/, async (req, res) => {
  const { auth, code } = await readBody(req);
  await checkSigned(auth, 'settings');
  const row = db.prepare('SELECT email, code_hash, expires_at, tries FROM email_codes WHERE owner = ?').get(config.ownerId) as { email: string; code_hash: string; expires_at: number; tries: number } | undefined;
  if (!row || row.expires_at < Date.now()) throw new HttpError(400, 'The code has expired. Ask for a new one.');
  if (row.tries >= 5) throw new HttpError(429, 'Too many wrong codes. Ask for a new one.');
  if (sha256(String(code ?? '').trim()) !== row.code_hash) {
    db.prepare('UPDATE email_codes SET tries = tries + 1 WHERE owner = ?').run(config.ownerId);
    throw new HttpError(400, 'That code isn’t right. Check the email and try again.');
  }
  db.prepare('DELETE FROM email_codes WHERE owner = ?').run(config.ownerId);
  updateSettings(config.ownerId, { email: row.email, email_enabled: 1 });
  log.info('Email verified for the owner.');
  send(res, 200, await settingsView(config.ownerId));
});

route('POST', /^\/api\/telegram\/link$/, async (req, res) => {
  const { auth } = await readBody(req);
  await checkSigned(auth, 'settings');
  if (!telegramEnabled()) throw new HttpError(503, 'Telegram isn’t configured on the service (TELEGRAM_BOT_TOKEN).');
  send(res, 200, { url: await linkUrl(config.ownerId) });
});

route('POST', /^\/api\/checkin\/wallet$/, async (req, res) => {
  const { auth } = await readBody(req);
  await checkSigned(auth, 'check-in');
  const r = await operatorCheckin('website');
  log.info(`Website check-in: ${r.status}`);
  send(res, 200, r);
});

/* One-time links. GET only shows a page (email scanners open links); POST checks in. */
route('GET', /^\/checkin\/([A-Za-z0-9_-]{20,100})$/, async (_req, res, m) => {
  const state = tokenState(m[1]);
  if (state !== 'valid') return send(res, 200, tokenPage(state, usedVia(m[1])), 'text/html');
  send(res, 200, page('Check in', `<h1>Are you still here?</h1><p>Press the button to reset your timer. That’s all it does: no wallet, no signature, no fee.</p>
<form method="post"><button type="submit">Check in</button></form>`), 'text/html');
});

route('POST', /^\/checkin\/([A-Za-z0-9_-]{20,100})$/, async (_req, res, m) => {
  try {
    const r = await checkinWithToken(m[1], 'email');
    if (r.status === 'checked_in') {
      return send(res, 200, page('Checked in', `<h1>You’re checked in.</h1><p>Your plan now runs on ${escapeHtml(utcDateTime(r.deadlineMs))}, in ${escapeHtml(humanDuration(r.deadlineMs - Date.now()))}.${r.dryRun ? ' (Test mode: nothing was sent.)' : ''}</p>`), 'text/html');
    }
    if (r.status === 'too_soon') return send(res, 200, page('Checked in', `<h1>You’re already checked in.</h1><p>Your plan runs on ${escapeHtml(utcDateTime(r.deadlineMs))}.</p>`), 'text/html');
    if (r.status === 'closed') return send(res, 200, page('Plan has run', '<h1>Your plan has already run.</h1><p>Check-ins are closed.</p>'), 'text/html');
    if (r.status === 'operator_off') return send(res, 200, page('Not checked in', '<h1>Not checked in</h1><p>Reminder check-ins are turned off in your settings. Check in on the website instead.</p>'), 'text/html');
    send(res, 200, tokenPage(r.status, usedVia(m[1])), 'text/html');
  } catch (e) {
    log.warn(`Link check-in failed: ${(e as Error).message}`);
    send(res, 502, page('Not checked in', '<h1>Something went wrong</h1><p>You’re not checked in yet. Try the button again in a minute, or check in on the website.</p>'), 'text/html');
  }
});

function tokenPage(state: string, via: 'email' | 'telegram' | null = null) {
  const text = state === 'used' ? ['You already answered this reminder', `${via === 'telegram' ? 'You answered it in Telegram. ' : via === 'email' ? 'You answered it from this email. ' : ''}Each reminder can be answered once.`]
    : state === 'expired' ? ['This link has expired', 'A newer reminder replaced it. Use the newest one, or check in on the website.']
      : ['This link isn’t valid', 'Check in on the website instead.'];
  return page(text[0], `<h1>${text[0]}</h1><p>${text[1]}</p>`);
}

/* ---------------- server ---------------- */

export function startHttp() {
  const server = createServer(async (req, res) => {
    const origin = allowedOrigin(req.headers.origin);
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    for (const [method, re, h] of routes) {
      const m = path.match(re);
      if (m && method === req.method) {
        try { await h(req, res, m); } catch (e) {
          const status = e instanceof HttpError ? e.status : 500;
          if (status === 500) log.warn(`${req.method} ${path}: ${(e as Error).message}`);
          if (!res.headersSent) send(res, status, { error: status === 500 ? `The service hit an error: ${(e as Error).message}` : (e as Error).message });
        }
        return;
      }
    }
    send(res, 404, { error: 'Not found.' });
  });
  /* Only this machine by default; set HOST=0.0.0.0 to deliberately serve other devices. */
  server.listen(config.port, config.host, () => log.info(`HTTP on ${config.publicBaseUrl} (listening on ${config.host}:${config.port})`));
}

