import { config } from './config';
import { db, getSettings, randomToken, sha256 } from './db';
import { dueReminder, nextReminderAfter, reminderTimes } from './schedule';
import { balances, currentSalt, getStatus, nsToMs, operatorBalanceNear, previewSweep, sendTx, tokenMeta, type Status } from './near';
import { emailEnabled, sendEmail } from './email';
import { chatIdForUsername, sendTelegram, telegramEnabled } from './telegram';
import { heirNotice, reminderHtml, reminderSubject, reminderText } from './messages';
import { formatAmount } from './format';
import { log } from './log';

const MAX_SWEEP_ATTEMPTS = 3;
/* The demo needs reminders within seconds of their time; otherwise once a minute is plenty. */
const TICK_MS = config.demoOffsets.length ? 10_000 : 60_000;

/** Reminder times for the current check-in period, given the chain status. */
export function scheduleFor(s: Status) {
  const last = nsToMs(s.last_ping_ns);
  const deadline = nsToMs(s.deadline_ns);
  const times = reminderTimes(last, deadline, config.demoOffsets);
  const sent = db.prepare('SELECT MAX(scheduled_for) AS t, MAX(sent_at) AS s FROM reminders WHERE owner = ? AND sent_at > ?').get(config.ownerId, last) as { t: number | null; s: number | null };
  return { last, deadline, times, lastScheduled: sent.t ?? null, lastSentAt: sent.s ?? null };
}

async function remind(s: Status) {
  const { deadline, times, lastScheduled, lastSentAt } = scheduleFor(s);
  const due = dueReminder(times, Date.now(), lastScheduled, lastSentAt, config.demoOffsets.length > 0);
  if (due === null) return;
  await sendReminder(s, due, times, deadline, true);
}

/**
 * Sends one reminder (email and/or Telegram) with a fresh one-time link. Older links stop
 * working. With `record` false (the test command) it doesn't count towards the schedule.
 */
export async function sendReminder(s: Status, due: number, times: number[], deadline: number, record: boolean) {
  const now = Date.now();
  const st = getSettings(config.ownerId);
  const byEmail = !!(st.email_enabled && st.email && emailEnabled());
  const byTelegram = !!(st.tg_enabled && st.tg_chat_id && telegramEnabled());
  if (!byEmail && !byTelegram) {
    if (record) db.prepare('INSERT INTO reminders (owner, scheduled_for, sent_at, channels) VALUES (?, ?, ?, ?)').run(config.ownerId, due, now, 'none');
    log.warn('A reminder was due, but no channel is set up (email or Telegram).');
    return [];
  }

  /* A new link: the previous ones stop working now. This one works until the next reminder. */
  const next = nextReminderAfter(times, due);
  db.prepare('UPDATE checkin_tokens SET expires_at = ? WHERE owner = ? AND used_at IS NULL AND expires_at > ?').run(now, config.ownerId, now);
  const token = randomToken();
  db.prepare('INSERT INTO checkin_tokens (hash, owner, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha256(token), config.ownerId, now, next ?? deadline);

  const msg = { deadlineMs: deadline, nowMs: now, timeoutSecs: s.timeout_secs, nextReminderMs: next, link: `${config.publicBaseUrl}/checkin/${token}` };
  const channels: string[] = [];
  if (byEmail) {
    try { await sendEmail(st.email!, reminderSubject(msg), reminderText(msg) + `\n\nI’m still here: ${msg.link}`, reminderHtml(msg)); channels.push('email'); }
    catch (e) { log.warn(`Email reminder failed: ${(e as Error).message}`); }
  }
  if (byTelegram) {
    try { await sendTelegram(st.tg_chat_id!, reminderText(msg), token); channels.push('telegram'); }
    catch (e) { log.warn(`Telegram reminder failed: ${(e as Error).message}`); }
  }
  if (record) db.prepare('INSERT INTO reminders (owner, scheduled_for, sent_at, channels) VALUES (?, ?, ?, ?)').run(config.ownerId, due, now, channels.join(',') || 'failed');
  log.info(`Reminder sent (${channels.join(' + ') || 'nothing delivered'}); the plan runs ${new Date(deadline).toISOString()}.`);
  return channels;
}

/* At the deadline: sweep every token with a balance, then tell the heirs once. */
async function carryOut(s: Status) {
  const deadline = nsToMs(s.deadline_ns);
  const held = (await balances(s.owner)).filter((b) => BigInt(b.amount) > 0n);
  for (const b of held) {
    db.prepare('INSERT OR IGNORE INTO sweeps (deadline_ms, token_id) VALUES (?, ?)').run(deadline, b.id);
    const row = db.prepare('SELECT attempts, tx FROM sweeps WHERE deadline_ms = ? AND token_id = ?').get(deadline, b.id) as { attempts: number; tx: string | null };
    if (row.tx) continue;
    if (row.attempts >= MAX_SWEEP_ATTEMPTS) continue;   // already reported loudly
    const payouts = await previewSweep(b.amount);
    try {
      const tx = await sendTx('sweep', { token_id: b.id, amount: b.amount, salt: await currentSalt() }, 300);
      db.prepare('UPDATE sweeps SET attempts = attempts + 1, tx = ?, payouts = ?, last_error = NULL WHERE deadline_ms = ? AND token_id = ?')
        .run(tx, JSON.stringify(payouts), deadline, b.id);
      log.info(`Swept ${b.amount} ${b.id}: tx ${tx}`);
    } catch (e) {
      const err = (e as Error).message;
      db.prepare('UPDATE sweeps SET attempts = attempts + 1, last_error = ? WHERE deadline_ms = ? AND token_id = ?').run(err, deadline, b.id);
      if (row.attempts + 1 >= MAX_SWEEP_ATTEMPTS) log.loud(`SWEEP OF ${b.id} FAILED ${MAX_SWEEP_ATTEMPTS} TIMES; not retrying. Last error: ${err}. Anyone can still carry out the plan at ${config.siteUrl}/heir`);
    }
  }
  await notifyHeirs(s, deadline);
}

async function notifyHeirs(s: Status, deadline: number) {
  const st = getSettings(config.ownerId);
  if (!st.notify_heirs) return;
  if (db.prepare('SELECT 1 FROM heir_notices WHERE owner = ? AND deadline_ms = ?').get(config.ownerId, deadline)) return;
  const done = db.prepare('SELECT token_id, payouts FROM sweeps WHERE deadline_ms = ? AND tx IS NOT NULL').all(deadline) as { token_id: string; payouts: string }[];
  if (!done.length) return;   // nothing has moved yet
  const contacts = JSON.parse(st.heir_contacts) as Record<string, string>;
  for (const h of s.heirs) {
    const contact = contacts[h.account_id];
    if (!contact) continue;
    const parts: string[] = [];
    for (const d of done) {
      const p = (JSON.parse(d.payouts) as { account_id: string; amount: string }[]).find((x) => x.account_id === h.account_id);
      if (p) { const m = await tokenMeta(d.token_id); parts.push(`${formatAmount(p.amount, m.decimals)} ${m.symbol}`); }
    }
    if (!parts.length) continue;
    const text = heirNotice(s.owner, parts.join(', '));
    try {
      if (contact.includes('@') && !contact.startsWith('@')) await sendEmail(contact, `${s.owner}’s plan has run`, text);
      else {
        const chat = chatIdForUsername(contact);
        if (chat) await sendTelegram(chat, text);
        else log.warn(`Can’t message ${contact} on Telegram: they haven’t started the bot yet.`);
      }
    } catch (e) { log.warn(`Notice to ${h.account_id} failed: ${(e as Error).message}`); }
  }
  db.prepare('INSERT INTO heir_notices (owner, deadline_ms, sent_at) VALUES (?, ?, ?)').run(config.ownerId, deadline, Date.now());
  log.info('The people in the plan were told it has run.');
}

let lastBalanceCheck = 0;
async function watchOperatorBalance() {
  if (Date.now() - lastBalanceCheck < 3_600_000) return;
  lastBalanceCheck = Date.now();
  const near = await operatorBalanceNear();
  if (near < 0.1) log.warn(`The check-in operator ${config.operatorId} has only ${near} NEAR left. Top it up: it pays every check-in and sweep.`);
}

export async function tick() {
  const s = await getStatus();
  if (s.owner !== config.ownerId) log.warn(`OWNER_ID is ${config.ownerId} but the contract's owner is ${s.owner}.`);
  if (s.triggered) await carryOut(s);
  else if (s.timer_enabled) await remind(s);
  await watchOperatorBalance();
}

export async function startScheduler() {
  const loop = async () => {
    try { await tick(); } catch (e) { log.warn(`Scheduler: ${(e as Error).message}`); }
    setTimeout(loop, TICK_MS);
  };
  loop();
}
