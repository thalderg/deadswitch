import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
export const db = new DatabaseSync(new URL('../data/deadswitch.db', import.meta.url).pathname);

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  owner TEXT PRIMARY KEY,
  email TEXT, email_enabled INTEGER NOT NULL DEFAULT 0,
  tg_chat_id TEXT, tg_enabled INTEGER NOT NULL DEFAULT 0,
  notify_heirs INTEGER NOT NULL DEFAULT 0,
  heir_contacts TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS email_codes (owner TEXT PRIMARY KEY, email TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS tg_links (code TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tg_users (username TEXT PRIMARY KEY, chat_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS checkin_tokens (hash TEXT PRIMARY KEY, owner TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, scheduled_for INTEGER NOT NULL, sent_at INTEGER NOT NULL, channels TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS checkins (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, source TEXT NOT NULL, at_ms INTEGER NOT NULL, tx TEXT);
CREATE TABLE IF NOT EXISTS sweeps (
  deadline_ms INTEGER NOT NULL, token_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, tx TEXT, payouts TEXT, last_error TEXT,
  PRIMARY KEY (deadline_ms, token_id)
);
CREATE TABLE IF NOT EXISTS heir_notices (owner TEXT NOT NULL, deadline_ms INTEGER NOT NULL, sent_at INTEGER NOT NULL, PRIMARY KEY (owner, deadline_ms));
`);

/* Which channel answered a reminder: 'email' or 'telegram'. */
try { db.exec('ALTER TABLE checkin_tokens ADD COLUMN used_via TEXT'); } catch { /* already there */ }

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** URL-safe random token; 32 bytes -> 43 characters (fits Telegram's 64-byte callback data). */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export interface SettingsRow {
  owner: string; email: string | null; email_enabled: number; tg_chat_id: string | null; tg_enabled: number;
  notify_heirs: number; heir_contacts: string;
}

export function getSettings(owner: string): SettingsRow {
  db.prepare('INSERT OR IGNORE INTO settings (owner) VALUES (?)').run(owner);
  return db.prepare('SELECT * FROM settings WHERE owner = ?').get(owner) as unknown as SettingsRow;
}

export function updateSettings(owner: string, patch: Partial<Omit<SettingsRow, 'owner'>>) {
  getSettings(owner);
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  db.prepare(`UPDATE settings SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE owner = ?`)
    .run(...keys.map((k) => patch[k] as string | number | null), owner);
}

export function recordCheckin(owner: string, source: 'website' | 'email' | 'telegram', tx: string | null) {
  db.prepare('INSERT INTO checkins (owner, source, at_ms, tx) VALUES (?, ?, ?, ?)').run(owner, source, Date.now(), tx);
}

export function lastCheckin(owner: string): { source: string; at_ms: number } | null {
  return (db.prepare('SELECT source, at_ms FROM checkins WHERE owner = ? ORDER BY at_ms DESC LIMIT 1').get(owner) as never) ?? null;
}
