/* Pure formatting helpers (unit-tested in format.test.ts). */

export const NS_PER_MS = 1_000_000n;

/** Nanoseconds as a string -> milliseconds as a number. */
export const nsToMs = (ns: string | bigint) => Number(BigInt(ns) / NS_PER_MS);

/** Smallest-unit amount -> human string, trimmed to `maxFrac` decimals. */
export function formatAmount(raw: string, decimals: number, maxFrac = 4): string {
  const v = BigInt(raw);
  if (decimals === 0) return v.toLocaleString('en-US');
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = (v % base).toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
  if (whole === 0n && !frac && v > 0n) return '< ' + (1 / 10 ** maxFrac).toFixed(maxFrac);
  return whole.toLocaleString('en-US') + (frac ? '.' + frac : '');
}

/** Basis points -> "70%" (or "33.33%"). */
export const bpsToPct = (bps: number) => (bps % 100 === 0 ? `${bps / 100}%` : `${(bps / 100).toFixed(2)}%`);

const units: [number, string][] = [
  [365 * 864e5, 'year'], [30 * 864e5, 'month'], [7 * 864e5, 'week'],
  [864e5, 'day'], [36e5, 'hour'], [6e4, 'minute'], [1e3, 'second'],
];

/** A duration in ms -> "3 days", "1 hour", "45 seconds" (largest unit, rounded down). */
export function humanDuration(ms: number): string {
  ms = Math.max(0, ms);
  for (const [size, name] of units) {
    if (ms >= size) {
      const n = Math.floor(ms / size);
      return `${n} ${name}${n === 1 ? '' : 's'}`;
    }
  }
  return '0 seconds';
}

/** Two-part duration for countdowns: "158 days 20 h", "4 h 05 min", "3 min 07 s". */
export function countdown(ms: number): string {
  ms = Math.max(0, ms);
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5);
  const m = Math.floor((ms % 36e5) / 6e4), s = Math.floor((ms % 6e4) / 1e3);
  const p2 = (n: number) => String(n).padStart(2, '0');
  if (d >= 1) return `${d} ${d === 1 ? 'day' : 'days'} ${h} h ${p2(m)} min`;
  if (h >= 1) return `${h} h ${p2(m)} min ${p2(s)} s`;
  return `${m} min ${p2(s)} s`;
}

/** "3 days ago", "just now", "yesterday". */
export function ago(ms: number): string {
  if (ms < 6e4) return 'just now';
  if (ms >= 864e5 && ms < 2 * 864e5) return 'yesterday';
  return `${humanDuration(ms)} ago`;
}

/** "12 May 2027 at 09:14 UTC". */
export function utcDateTime(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `${date} at ${time} UTC`;
}

/** "12 May 2027" (UTC). */
export const utcDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Percent of the check-in period that has passed, 0-100. */
export function passedPct(lastMs: number, deadlineMs: number, nowMs: number): number {
  const total = deadlineMs - lastMs;
  if (total <= 0) return 100;
  return Math.min(100, Math.max(0, ((nowMs - lastMs) / total) * 100));
}

/** Percent string with one decimal under 10%, whole numbers above. */
export const pctLabel = (p: number) => (p < 10 ? p.toFixed(1) : String(Math.round(p)));

/** The "left" label that always adds up to 100 with pctLabel(passed). */
export const leftLabel = (passed: number) =>
  passed < 10 ? (100 - Number(passed.toFixed(1))).toFixed(1) : String(100 - Math.round(passed));

/** Share of `amount` for `bps`, matching the contract's split for all but the last heir. */
export function shareOf(amount: string, bps: number): string {
  const a = BigInt(amount), b = BigInt(bps);
  return (a / 10000n * b + a % 10000n * b / 10000n).toString();
}

/** "50, 30, 20" percent inputs -> basis points; null if invalid. */
export function pctToBps(pct: string): number | null {
  const n = Number(pct.trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  const bps = Math.round(n * 100);
  return Math.abs(bps - n * 100) < 1e-6 ? bps : null;
}

/** Short form of a public key: ed25519:DDLPgZdq…aRJRSZc */
export const shortKey = (k: string) => (k.length > 24 ? `${k.slice(0, 16)}…${k.slice(-7)}` : k);
