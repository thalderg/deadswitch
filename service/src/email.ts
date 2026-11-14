import { config } from './config';
import { log } from './log';

export const emailEnabled = () => !!(config.resendKey && config.emailFrom);

/** Sends an email through Resend's HTTP API. */
export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<void> {
  if (!emailEnabled()) throw new Error('Email isn’t configured on the service (RESEND_API_KEY and EMAIL_FROM).');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.emailFrom, to: [to], subject, text, ...(html ? { html } : {}) }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend refused the email (${res.status}): ${body.slice(0, 200)}`);
  }
  log.info(`Email sent: "${subject}"`);
}
