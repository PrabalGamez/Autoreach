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

/**
 * v0.1 target kinds were label/brand/collaborator/other. SQLite cannot change a CHECK constraint,
 * so the table is rebuilt from schema.sql with label -> company and collaborator -> person.
 */
function migrateTargetKinds(d: Database.Database) {
  const row = d.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'targets'").get() as { sql: string } | undefined;
  if (!row || !row.sql.includes("'label'")) return;
  const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  const ddl = schema.match(/CREATE TABLE IF NOT EXISTS targets \(([\s\S]*?)\n\);/)![0].replace('CREATE TABLE IF NOT EXISTS targets', 'CREATE TABLE targets_new');
  const cols = (d.prepare('PRAGMA table_info(targets)').all() as { name: string }[]).map((c) => c.name);
  const select = cols.map((c) => (c === 'kind' ? "CASE kind WHEN 'label' THEN 'company' WHEN 'collaborator' THEN 'person' ELSE kind END" : c)).join(', ');
  d.pragma('foreign_keys = OFF');
  d.transaction(() => {
    d.exec(ddl);
    d.exec(`INSERT INTO targets_new (${cols.join(', ')}) SELECT ${select} FROM targets`);
    d.exec('DROP TABLE targets');
    d.exec('ALTER TABLE targets_new RENAME TO targets');
    d.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_target_email ON targets(lower(contact_email)) WHERE contact_email IS NOT NULL');
    d.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_target_domain ON targets(lower(domain)) WHERE domain IS NOT NULL');
  })();
  d.pragma('foreign_keys = ON');
}

/** Columns added after the first release. CREATE TABLE IF NOT EXISTS does not add them to old databases. */
const ADDED_COLUMNS: [table: string, column: string, ddl: string][] = [
  ['profile', 'profile_context', 'TEXT'],
  ['profile', 'context_at', 'TEXT'],
  ['profile', 'context_skipped_at', 'TEXT'],
];
export function migrate(d: Database.Database) {
  const profileCols = (d.prepare('PRAGMA table_info(profile)').all() as { name: string }[]).map((c) => c.name);
  // v0.1 was music-only: artist_context became profile_context.
  if (profileCols.includes('artist_context') && !profileCols.includes('profile_context')) d.exec('ALTER TABLE profile RENAME COLUMN artist_context TO profile_context');
  migrateTargetKinds(d);
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
export type SendMode = 'gmail_web' | 'gmail_api';

export const DEFAULT_SETTINGS = {
  /** gmail_web: open each approved email in Gmail's compose window, you press Send. No setup, nothing stored.
   *  gmail_api: send and watch replies automatically through your own Google OAuth client. */
  send_mode: 'gmail_web' as SendMode,
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
  if (s.send_mode !== 'gmail_api') s.send_mode = 'gmail_web';
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
