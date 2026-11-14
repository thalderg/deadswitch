import { config } from './config';
import { db, randomToken, updateSettings } from './db';
import { checkinWithToken, usedVia } from './checkin';
import { humanDuration, utcDateTime } from './format';
import { log } from './log';

const api = async <T>(method: string, body: object = {}): Promise<T> => {
  const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json() as { ok: boolean; result: T; description?: string };
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description ?? res.status}`);
  return data.result;
};

export const telegramEnabled = () => !!config.telegramToken;

let botUsername = '';
export async function botName(): Promise<string> {
  if (!botUsername) botUsername = (await api<{ username: string }>('getMe')).username;
  return botUsername;
}

/** A deep link that links the owner's Telegram chat: t.me/<bot>?start=<one-time code>. */
export async function linkUrl(owner: string): Promise<string> {
  const code = randomToken(16);
  db.prepare('INSERT INTO tg_links (code, owner, expires_at) VALUES (?, ?, ?)').run(code, owner, Date.now() + 30 * 60_000);
  return `https://t.me/${await botName()}?start=${code}`;
}

export async function sendTelegram(chatId: string, text: string, buttonToken?: string) {
  await api('sendMessage', {
    chat_id: chatId, text,
    ...(buttonToken ? { reply_markup: { inline_keyboard: [[{ text: 'I’m still here', callback_data: buttonToken }]] } } : {}),
  });
}

/** Chat id of a person who has written to the bot, by @username (for notices to heirs). */
export function chatIdForUsername(username: string): string | null {
  const row = db.prepare('SELECT chat_id FROM tg_users WHERE username = ?').get(username.replace(/^@/, '').toLowerCase()) as { chat_id: string } | undefined;
  return row?.chat_id ?? null;
}

interface Update {
  update_id: number;
  message?: { chat: { id: number }; from?: { username?: string }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } }; from?: { username?: string } };
}

async function handle(u: Update) {
  const from = u.message?.from ?? u.callback_query?.from;
  const chat = u.message?.chat.id ?? u.callback_query?.message?.chat.id;
  if (from?.username && chat) db.prepare('INSERT OR REPLACE INTO tg_users (username, chat_id) VALUES (?, ?)').run(from.username.toLowerCase(), String(chat));

  if (u.message?.text?.startsWith('/start')) {
    const code = u.message.text.split(/\s+/)[1];
    const chatId = String(u.message.chat.id);
    if (!code) {
      await sendTelegram(chatId, 'Hello. This is the Deadswitch reminder bot. To get reminders, press “Link Telegram” on your Deadswitch dashboard. If you’re in someone’s plan, you’ll get a message here if it runs.');
      return;
    }
    const row = db.prepare('SELECT owner, expires_at FROM tg_links WHERE code = ?').get(code) as { owner: string; expires_at: number } | undefined;
    db.prepare('DELETE FROM tg_links WHERE code = ?').run(code);
    if (!row || row.expires_at < Date.now()) {
      await sendTelegram(chatId, 'This link has expired. Press “Link Telegram” on your dashboard again.');
      return;
    }
    updateSettings(row.owner, { tg_chat_id: chatId, tg_enabled: 1 });
    log.info(`Telegram linked for ${row.owner}`);
    await sendTelegram(chatId, 'Linked. Your Deadswitch reminders will arrive here, with an “I’m still here” button that checks you in. It never asks you to connect a wallet or sign anything.');
    return;
  }

  const cb = u.callback_query;
  if (cb?.data && cb.message) {
    const chatId = String(cb.message.chat.id);
    let reply: string;
    try {
      const r = await checkinWithToken(cb.data, 'telegram');
      reply = r.status === 'checked_in' ? `You’re checked in.${'dryRun' in r && r.dryRun ? ' (Test mode: nothing was sent.)' : ''} Your plan now runs on ${utcDateTime(r.deadlineMs)}, in ${humanDuration(r.deadlineMs - Date.now())}.`
        : r.status === 'too_soon' ? `You’re already checked in. Your plan runs on ${utcDateTime(r.deadlineMs)}.`
          : r.status === 'used' ? `You already answered this reminder${usedVia(cb.data) === 'email' ? ' from the email' : ''}. Each reminder can be answered once.`
            : r.status === 'expired' ? 'This button has expired. Use the newest reminder, or check in on the website.'
              : r.status === 'closed' ? 'Your plan has already run, so check-ins are closed.'
                : r.status === 'operator_off' ? 'Reminder check-ins are turned off in your settings. Check in on the website instead.'
                  : 'This button isn’t valid. Check in on the website instead.';
    } catch (e) {
      log.warn(`Telegram check-in failed: ${(e as Error).message}`);
      reply = 'Something went wrong and you’re not checked in yet. Try again in a minute, or check in on the website.';
    }
    await api('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
    await sendTelegram(chatId, reply);
  }
}

/** Long-polls Telegram for messages and button taps (no public URL needed). */
export async function startTelegram() {
  if (!telegramEnabled()) { log.info('Telegram is off (no TELEGRAM_BOT_TOKEN).'); return; }
  for (;;) {
    try { log.info(`Telegram bot @${await botName()} is listening.`); break; }
    catch (e) { log.warn(`Telegram bot not reachable (${(e as Error).message}); retrying in 10 s.`); await new Promise((r) => setTimeout(r, 10_000)); }
  }
  let offset = 0;
  for (;;) {
    try {
      const updates = await api<Update[]>('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        await handle(u).catch((e) => log.warn(`Telegram update failed: ${(e as Error).message}`));
      }
    } catch (e) {
      log.warn(`Telegram polling: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
