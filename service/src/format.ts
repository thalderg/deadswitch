/* Formatting shared by messages and pages (same rules as web/src/lib/format.ts). */

const units: [number, string][] = [
  [365 * 864e5, 'year'], [30 * 864e5, 'month'], [7 * 864e5, 'week'],
  [864e5, 'day'], [36e5, 'hour'], [6e4, 'minute'], [1e3, 'second'],
];

export function humanDuration(ms: number): string {
  ms = Math.max(0, ms);
  for (const [size, name] of units) {
    if (ms >= size) { const n = Math.floor(ms / size); return `${n} ${name}${n === 1 ? '' : 's'}`; }
  }
  return '0 seconds';
}

export function utcDateTime(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `${date} at ${time} UTC`;
}

export function formatAmount(raw: string, decimals: number, maxFrac = 4): string {
  const v = BigInt(raw);
  if (decimals === 0) return v.toLocaleString('en-US');
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
  if (whole === 0n && !frac && v > 0n) return '< ' + (1 / 10 ** maxFrac).toFixed(maxFrac);
  return whole.toLocaleString('en-US') + (frac ? '.' + frac : '');
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** "g•••@gmail.com" */
export function maskEmail(e: string): string {
  const [user, domain] = e.split('@');
  return `${user.slice(0, 1)}•••@${domain}`;
}
