PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  alias TEXT NOT NULL DEFAULT '',
  real_name TEXT NOT NULL DEFAULT '',
  pitch TEXT NOT NULL DEFAULT '',
  niches TEXT NOT NULL DEFAULT '[]',          -- JSON string[]
  links TEXT NOT NULL DEFAULT '[]',           -- JSON {label,url}[]
  best_works TEXT NOT NULL DEFAULT '[]',      -- JSON {title,url,note}[]
  goals TEXT NOT NULL DEFAULT '[]',           -- JSON string[]
  voice_samples TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  voice_profile TEXT,                         -- JSON {tone,length,greeting,signoff,traits[]}
  sender_email TEXT,
  postal_address TEXT NOT NULL DEFAULT '',
  artist_context TEXT,                        -- JSON, Claude's research on the artist
  context_at TEXT,
  context_skipped_at TEXT,
  onboarded_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO profile (id) VALUES (1);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  relationship TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS targets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'label' CHECK (kind IN ('label','brand','collaborator','other')),
  domain TEXT,
  contact_email TEXT,
  contact_source_url TEXT,
  route TEXT NOT NULL DEFAULT 'email' CHECK (route IN ('email','form_only')),
  form_url TEXT,
  timezone TEXT,
  referred_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('ai','csv','manual')),
  why_fit TEXT NOT NULL DEFAULT '',
  proposal_sources TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'researching' CHECK (status IN
    ('proposed','researching','draft_ready','approved','sent','replied','offer','closed','declined','rejected')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_target_email ON targets(lower(contact_email)) WHERE contact_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_target_domain ON targets(lower(domain)) WHERE domain IS NOT NULL;

CREATE TABLE IF NOT EXISTS briefs (
  target_id INTEGER PRIMARY KEY REFERENCES targets(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  aesthetic TEXT NOT NULL DEFAULT '',
  recent TEXT NOT NULL DEFAULT '[]',
  favourites TEXT NOT NULL DEFAULT '[]',
  possible_deals TEXT NOT NULL DEFAULT '[]',
  submission_rules TEXT NOT NULL DEFAULT '',
  red_flags TEXT NOT NULL DEFAULT '[]',
  sources TEXT NOT NULL DEFAULT '[]',
  researched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY,
  target_id INTEGER REFERENCES targets(id) ON DELETE CASCADE,
  person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('initial','followup','intro_request','reply')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  unique_reference TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  regen_note TEXT,
  link_used TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN
    ('pending','approved','skipped','discarded','queued','sent','failed','submitted_form')),
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_drafts_state ON drafts(state);

CREATE TABLE IF NOT EXISTS send_queue (
  draft_id INTEGER PRIMARY KEY REFERENCES drafts(id) ON DELETE CASCADE,
  not_before TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  enqueued_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  draft_id INTEGER REFERENCES drafts(id) ON DELETE SET NULL,
  target_id INTEGER REFERENCES targets(id) ON DELETE SET NULL,
  person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'gmail' CHECK (channel IN ('gmail','form')),
  gmail_message_id TEXT UNIQUE,
  rfc_message_id TEXT,
  thread_id TEXT,
  to_email TEXT,
  subject TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_msg_thread ON messages(thread_id);

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY,
  gmail_message_id TEXT UNIQUE,
  thread_id TEXT NOT NULL,
  target_id INTEGER REFERENCES targets(id) ON DELETE SET NULL,
  person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  from_email TEXT,
  received_at TEXT,
  snippet TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  label TEXT CHECK (label IN ('offer','interested','decline','auto_reply','other','opt_out')),
  confidence REAL,
  summary TEXT,
  terms TEXT,
  classified_at TEXT
);

CREATE TABLE IF NOT EXISTS offer_alerts (
  id INTEGER PRIMARY KEY,
  reply_id INTEGER UNIQUE REFERENCES replies(id) ON DELETE CASCADE,
  email_sent_at TEXT,
  notified_at TEXT,
  channel_errors TEXT,
  acknowledged_at TEXT,
  handled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppression (
  value TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS referral_outcomes (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'suggested' CHECK (stage IN ('suggested','asked','intro_made','replied','offer','none')),
  reason TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (person_id, target_id)
);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id INTEGER PRIMARY KEY,
  task TEXT NOT NULL,
  target_id INTEGER,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','failed')),
  error TEXT,
  duration_ms INTEGER,
  cost_usd REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_state (key TEXT PRIMARY KEY, value TEXT);
