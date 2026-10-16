import { getDb, parseJson, nowIso } from './index.ts';
import type { Brief, Draft, Person, Profile, Target, TargetStatus } from '../../shared/types.ts';

// ---------- profile ----------
export function getProfile(): Profile {
  const r = getDb().prepare('SELECT * FROM profile WHERE id = 1').get() as Record<string, string | null>;
  return {
    alias: r.alias ?? '',
    real_name: r.real_name ?? '',
    pitch: r.pitch ?? '',
    niches: parseJson(r.niches, []),
    links: parseJson(r.links, []),
    best_works: parseJson(r.best_works, []),
    goals: parseJson(r.goals, []),
    voice_samples: parseJson(r.voice_samples, []),
    voice_profile: parseJson(r.voice_profile, null),
    sender_email: r.sender_email,
    postal_address: r.postal_address ?? '',
    onboarded_at: r.onboarded_at,
  };
}

const PROFILE_JSON = new Set(['niches', 'links', 'best_works', 'goals', 'voice_samples', 'voice_profile']);
const PROFILE_COLS = new Set(['alias', 'real_name', 'pitch', 'sender_email', 'postal_address', 'onboarded_at', ...PROFILE_JSON]);

export function saveProfile(patch: Partial<Profile>) {
  const entries = Object.entries(patch).filter(([k]) => PROFILE_COLS.has(k));
  if (!entries.length) return getProfile();
  const sets = entries.map(([k]) => `${k} = @${k}`).join(', ');
  const params = Object.fromEntries(entries.map(([k, v]) => [k, PROFILE_JSON.has(k) ? JSON.stringify(v) : v]));
  getDb().prepare(`UPDATE profile SET ${sets}, updated_at = datetime('now') WHERE id = 1`).run(params);
  return getProfile();
}

// ---------- domain helpers ----------
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^mailto:/, '');
  if (s.includes('@') && !s.includes('/')) s = s.split('@')[1];
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  return s || null;
}
const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me', 'protonmail.com', 'aol.com', 'live.com']);
/** Domain used for dedupe. Free-mail domains don't identify an organisation, so they are skipped. */
export function dedupeDomain(domain: string | null, email: string | null): string | null {
  const d = normalizeDomain(domain) ?? normalizeDomain(email);
  return d && !FREEMAIL.has(d) ? d : null;
}

// ---------- targets ----------
function mapTarget(r: Record<string, unknown>): Target {
  return {
    ...(r as unknown as Target),
    proposal_sources: parseJson(r.proposal_sources as string, []),
    suppressed: Boolean(r.suppressed),
  };
}

const TARGET_SELECT = `
  SELECT t.*, p.name AS referrer_name,
    EXISTS (SELECT 1 FROM suppression s WHERE s.value = lower(t.contact_email) OR s.value = lower(t.domain)) AS suppressed
  FROM targets t LEFT JOIN people p ON p.id = t.referred_by`;

export function getTarget(id: number): Target | null {
  const r = getDb().prepare(`${TARGET_SELECT} WHERE t.id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? mapTarget(r) : null;
}

export function listTargets(status?: TargetStatus): Target[] {
  const rows = status
    ? getDb().prepare(`${TARGET_SELECT} WHERE t.status = ? ORDER BY t.updated_at DESC`).all(status)
    : getDb().prepare(`${TARGET_SELECT} ORDER BY t.updated_at DESC`).all();
  return (rows as Record<string, unknown>[]).map(mapTarget);
}

export interface NewTarget {
  name: string;
  kind?: Target['kind'];
  domain?: string | null;
  contact_email?: string | null;
  contact_source_url?: string | null;
  route?: Target['route'];
  form_url?: string | null;
  timezone?: string | null;
  referred_by?: number | null;
  origin: Target['origin'];
  why_fit?: string;
  proposal_sources?: string[];
  status?: TargetStatus;
  notes?: string;
}

export function findDuplicate(t: { domain?: string | null; contact_email?: string | null; name?: string }): Target | null {
  const email = t.contact_email?.trim().toLowerCase() || null;
  const domain = dedupeDomain(t.domain ?? null, email);
  const r = getDb()
    .prepare(`${TARGET_SELECT} WHERE (? IS NOT NULL AND lower(t.contact_email) = ?) OR (? IS NOT NULL AND lower(t.domain) = ?) OR (lower(t.name) = lower(?)) LIMIT 1`)
    .get(email, email, domain, domain, t.name ?? '\u0000') as Record<string, unknown> | undefined;
  return r ? mapTarget(r) : null;
}

export function insertTarget(t: NewTarget): { target: Target; duplicate: boolean } {
  const dup = findDuplicate(t);
  if (dup) return { target: dup, duplicate: true };
  const email = t.contact_email?.trim().toLowerCase() || null;
  const info = getDb()
    .prepare(
      `INSERT INTO targets (name, kind, domain, contact_email, contact_source_url, route, form_url, timezone, referred_by, origin, why_fit, proposal_sources, status, notes)
       VALUES (@name, @kind, @domain, @contact_email, @contact_source_url, @route, @form_url, @timezone, @referred_by, @origin, @why_fit, @proposal_sources, @status, @notes)`,
    )
    .run({
      name: t.name.trim(),
      kind: t.kind ?? 'label',
      domain: dedupeDomain(t.domain ?? null, email),
      contact_email: email,
      contact_source_url: t.contact_source_url ?? null,
      route: t.route ?? (email ? 'email' : 'form_only'),
      form_url: t.form_url ?? null,
      timezone: t.timezone ?? null,
      referred_by: t.referred_by ?? null,
      origin: t.origin,
      why_fit: t.why_fit ?? '',
      proposal_sources: JSON.stringify(t.proposal_sources ?? []),
      status: t.status ?? 'researching',
      notes: t.notes ?? '',
    });
  return { target: getTarget(Number(info.lastInsertRowid))!, duplicate: false };
}

const TARGET_COLS = new Set(['name', 'kind', 'domain', 'contact_email', 'contact_source_url', 'route', 'form_url', 'timezone', 'referred_by', 'why_fit', 'status', 'notes']);
export function updateTarget(id: number, patch: Partial<Target>) {
  const entries = Object.entries(patch).filter(([k]) => TARGET_COLS.has(k));
  if (entries.length) {
    const params: Record<string, unknown> = Object.fromEntries(entries);
    if ('contact_email' in params) params.contact_email = (params.contact_email as string | null)?.trim().toLowerCase() || null;
    if ('domain' in params) params.domain = normalizeDomain(params.domain as string | null);
    const sets = Object.keys(params).map((k) => `${k} = @${k}`).join(', ');
    getDb().prepare(`UPDATE targets SET ${sets}, updated_at = datetime('now') WHERE id = @id`).run({ ...params, id });
  }
  return getTarget(id);
}

export function setTargetStatus(id: number, status: TargetStatus) {
  getDb().prepare("UPDATE targets SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
}

// ---------- briefs ----------
export function getBrief(targetId: number): Brief | null {
  const r = getDb().prepare('SELECT * FROM briefs WHERE target_id = ?').get(targetId) as Record<string, string> | undefined;
  if (!r) return null;
  return {
    summary: r.summary,
    aesthetic: r.aesthetic,
    recent: parseJson(r.recent, []),
    favourites: parseJson(r.favourites, []),
    possible_deals: parseJson(r.possible_deals, []),
    submission_rules: r.submission_rules,
    red_flags: parseJson(r.red_flags, []),
    sources: parseJson(r.sources, []),
    researched_at: r.researched_at,
  };
}

export function saveBrief(targetId: number, b: Omit<Brief, 'researched_at'>) {
  getDb()
    .prepare(
      `INSERT INTO briefs (target_id, summary, aesthetic, recent, favourites, possible_deals, submission_rules, red_flags, sources, researched_at)
       VALUES (@target_id, @summary, @aesthetic, @recent, @favourites, @possible_deals, @submission_rules, @red_flags, @sources, @at)
       ON CONFLICT(target_id) DO UPDATE SET summary = excluded.summary, aesthetic = excluded.aesthetic, recent = excluded.recent,
         favourites = excluded.favourites, possible_deals = excluded.possible_deals, submission_rules = excluded.submission_rules,
         red_flags = excluded.red_flags, sources = excluded.sources, researched_at = excluded.researched_at`,
    )
    .run({
      target_id: targetId,
      summary: b.summary,
      aesthetic: b.aesthetic,
      recent: JSON.stringify(b.recent),
      favourites: JSON.stringify(b.favourites),
      possible_deals: JSON.stringify(b.possible_deals),
      submission_rules: b.submission_rules,
      red_flags: JSON.stringify(b.red_flags),
      sources: JSON.stringify(b.sources),
      at: nowIso(),
    });
}

// ---------- drafts ----------
export function getDraft(id: number): Draft | null {
  return (getDb().prepare('SELECT * FROM drafts WHERE id = ?').get(id) as Draft | undefined) ?? null;
}

export function insertDraft(d: {
  target_id: number | null;
  person_id?: number | null;
  kind: Draft['kind'];
  subject: string;
  body: string;
  unique_reference?: string;
  link_used?: string | null;
  version?: number;
  regen_note?: string | null;
}): Draft {
  const info = getDb()
    .prepare(
      `INSERT INTO drafts (target_id, person_id, kind, subject, body, unique_reference, link_used, version, regen_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(d.target_id, d.person_id ?? null, d.kind, d.subject, d.body, d.unique_reference ?? '', d.link_used ?? null, d.version ?? 1, d.regen_note ?? null);
  return getDraft(Number(info.lastInsertRowid))!;
}

export function setDraftState(id: number, state: Draft['state']) {
  getDb()
    .prepare(`UPDATE drafts SET state = ?, approved_at = CASE WHEN ? IN ('approved','queued') THEN datetime('now') ELSE approved_at END WHERE id = ?`)
    .run(state, state, id);
}

/** Other recent drafts' bodies, used for the "doesn't look templated" check. */
export function otherDraftBodies(excludeTargetId: number | null, limit = 40): string[] {
  return (
    getDb()
      .prepare("SELECT body FROM drafts WHERE kind = 'initial' AND (target_id IS NULL OR target_id != ?) AND state != 'discarded' ORDER BY id DESC LIMIT ?")
      .all(excludeTargetId ?? -1, limit) as { body: string }[]
  ).map((r) => r.body);
}

// ---------- people ----------
export function listPeople(): Person[] {
  return getDb().prepare('SELECT id, name, email, relationship, notes FROM people ORDER BY name').all() as Person[];
}
export function getPerson(id: number): Person | null {
  return (getDb().prepare('SELECT id, name, email, relationship, notes FROM people WHERE id = ?').get(id) as Person | undefined) ?? null;
}
