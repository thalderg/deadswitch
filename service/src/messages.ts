import { config } from './config';
import { escapeHtml, humanDuration, utcDateTime } from './format';

export interface ReminderInput {
  deadlineMs: number;
  nowMs: number;
  timeoutSecs: number;
  nextReminderMs: number | null;
  link: string;   // the one-time check-in link
}

/** The reminder text (Telegram and plain-text email), per the approved copy. */
export function reminderText(r: ReminderInput): string {
  return [
    `Your plan runs on ${utcDateTime(r.deadlineMs)}, in ${humanDuration(r.deadlineMs - r.nowMs)}.`,
    '',
    `If you’re still here, confirm below and the timer resets to ${humanDuration(r.timeoutSecs * 1000)}.`,
    '',
    r.nextReminderMs ? `This link works until your next reminder on ${utcDateTime(r.nextReminderMs)}.` : 'This is your last reminder before your plan runs.',
    `You can also check in any time on the website: ${config.siteUrl}`,
    '',
    'Check-ins from reminders are free.',
    'This link only checks you in. It never asks you to connect a wallet or sign anything.',
  ].join('\n');
}

export const reminderSubject = (r: ReminderInput) => `Your Deadswitch plan runs in ${humanDuration(r.deadlineMs - r.nowMs)}`;

/** HTML email in the site's colours; same words as the text version. */
export function reminderHtml(r: ReminderInput): string {
  const p = (s: string, style = '') => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#A7B1C8;${style}">${s}</p>`;
  return `<!doctype html><html><body style="margin:0;background:#05070D;padding:32px 16px;font-family:Geist,Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#121A2E;border:1px solid #2A3556;border-radius:28px;padding:32px">
<p style="margin:0 0 20px;font-family:'Instrument Serif',Georgia,serif;font-size:28px;color:#EEF1F8">Deadswitch</p>
${p(`Your plan runs on <b style="color:#EEF1F8">${escapeHtml(utcDateTime(r.deadlineMs))}</b>, in ${escapeHtml(humanDuration(r.deadlineMs - r.nowMs))}.`, 'color:#EEF1F8;font-size:18px')}
${p(`If you’re still here, confirm below and the timer resets to ${escapeHtml(humanDuration(r.timeoutSecs * 1000))}.`)}
<p style="margin:8px 0 24px"><a href="${escapeHtml(r.link)}" style="display:inline-block;background:#7FD1C1;color:#05070D;text-decoration:none;font-weight:600;font-size:16px;padding:15px 28px;border-radius:999px">I’m still here</a></p>
${p(r.nextReminderMs ? `This link works until your next reminder on ${escapeHtml(utcDateTime(r.nextReminderMs))}.` : 'This is your last reminder before your plan runs.')}
${p(`You can also check in any time on the website: <a href="${escapeHtml(config.siteUrl)}" style="color:#7FD1C1">${escapeHtml(config.siteUrl)}</a>`)}
${p('Check-ins from reminders are free.<br>This link only checks you in. It never asks you to connect a wallet or sign anything.', 'font-size:14px;margin:0')}
</div></body></html>`;
}

/** The message to a person in the plan once it has run. */
export function heirNotice(owner: string, received: string): string {
  return [
    `${owner}’s plan has run. You received ${received} in your NEAR Intents account.`,
    `To withdraw it to your own wallet, visit near-intents.org or ${config.siteUrl}/heir.`,
  ].join('\n\n');
}
