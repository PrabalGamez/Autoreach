import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_PATH, ensureHome, HARD_DAILY_CAP } from '../config.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
let db: Database.Database | null = null;

export function openDb(file = DB_PATH): Database.Database {
  if (db) return db;
  if (file !== ':memory:') ensureHome();
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  migrate(db);
  return db;
}

/** Columns added after the first release. CREATE TABLE IF NOT EXISTS does not add them to old databases. */
const ADDED_COLUMNS: [table: string, column: string, ddl: string][] = [
  ['profile', 'artist_context', 'TEXT'],
  ['profile', 'context_at', 'TEXT'],
  ['profile', 'context_skipped_at', 'TEXT'],
];
export function migrate(d: Database.Database) {
  for (const [table, column, ddl] of ADDED_COLUMNS) {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

export function getDb(): Database.Database {
  return db ?? openDb();
}

/** Tests only. */
export function resetDbForTests() {
  db?.close();
  db = null;
  return openDb(':memory:');
}

export const nowIso = () => new Date().toISOString();

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ---- system_state ----
export function getState(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM system_state WHERE key = ?').get(key) as
    | { value: string | null }
    | undefined;
  return row?.value ?? null;
}
export function setState(key: string, value: string | null) {
  getDb()
    .prepare('INSERT INTO system_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

// ---- pause switch ----
export function pause(reason: string) {
  setState('paused', '1');
  setState('pause_reason', reason);
  setState('paused_at', nowIso());
}
export function unpause() {
  setState('paused', null);
  setState('pause_reason', null);
}
export function pauseInfo() {
  return { paused: getState('paused') === '1', reason: getState('pause_reason'), since: getState('paused_at') };
}

// ---- settings ----
export const DEFAULT_SETTINGS = {
  daily_cap: 25,
  gap_min_minutes: 2,
  gap_max_minutes: 6,
  followups_enabled: true,
  followup_days: 7,
  poll_minutes: 10,
  send_window_start: 9,
  send_window_end: 18,
  model_drafting: 'sonnet',
  model_research: 'sonnet',
  model_classify: 'sonnet',
  alert_email: true,
  alert_desktop: true,
  offer_confidence: 0.6,
};
export type Settings = typeof DEFAULT_SETTINGS;

export function getSettings(): Settings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = parseJson(r.value, out[r.key]);
  const s = out as Settings;
  s.daily_cap = Math.max(1, Math.min(HARD_DAILY_CAP, Math.round(s.daily_cap)));
  s.gap_min_minutes = Math.max(1, s.gap_min_minutes);
  s.gap_max_minutes = Math.max(s.gap_min_minutes, s.gap_max_minutes);
  s.followup_days = Math.max(1, Math.round(s.followup_days));
  s.poll_minutes = Math.max(2, Math.round(s.poll_minutes));
  return s;
}

export function saveSettings(patch: Partial<Settings>) {
  const stmt = getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  for (const [k, v] of Object.entries(patch)) if (k in DEFAULT_SETTINGS) stmt.run(k, JSON.stringify(v));
  return getSettings();
}
