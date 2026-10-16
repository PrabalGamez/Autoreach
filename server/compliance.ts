import { getDb, pauseInfo } from './db/index.ts';
import { getDraft, getTarget, getPerson, normalizeDomain } from './db/repo.ts';

const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me', 'protonmail.com', 'aol.com', 'live.com']);

export function suppress(value: string | null | undefined, reason: string) {
  const v = value?.trim().toLowerCase();
  if (!v) return;
  getDb().prepare('INSERT OR IGNORE INTO suppression (value, reason) VALUES (?, ?)').run(v, reason);
}

/** Suppress an email, and its organisation domain unless it is a free-mail domain. */
export function suppressContact(email: string | null | undefined, reason: string) {
  if (!email) return;
  suppress(email, reason);
  const d = normalizeDomain(email);
  if (d && !FREEMAIL.has(d)) suppress(d, reason);
}

export function isSuppressed(email: string | null | undefined, domain?: string | null): boolean {
  const e = email?.trim().toLowerCase() ?? null;
  const d = normalizeDomain(domain ?? null) ?? (e ? normalizeDomain(e) : null);
  const row = getDb()
    .prepare('SELECT 1 FROM suppression WHERE value = ? OR (? IS NOT NULL AND value = ?) LIMIT 1')
    .get(e ?? '\u0000', d, d && !FREEMAIL.has(d) ? d : '\u0000');
  return Boolean(row);
}

const OPT_OUT_RE = /\b(unsubscribe|remove me|take me off|stop (emailing|contacting|sending)|do not (contact|email)|don'?t (contact|email) (me|us)( again)?|no (more|further) (emails|contact)|not interested,? (please )?(stop|remove))\b/i;
export function looksLikeOptOut(text: string) {
  return OPT_OUT_RE.test(text.slice(0, 2000));
}

export interface SendCheck {
  ok: boolean;
  reason?: string;
  to?: string;
}

/** The single gate every outgoing email passes. */
export function canSend(draftId: number): SendCheck {
  if (pauseInfo().paused) return { ok: false, reason: 'Autoreach is paused' };
  const d = getDraft(draftId);
  if (!d) return { ok: false, reason: 'Draft not found' };
  if (d.state !== 'approved' && d.state !== 'queued') return { ok: false, reason: `Draft is ${d.state}, not approved` };
  if (!d.approved_at) return { ok: false, reason: 'Draft has no approval timestamp' };

  let to: string | null = null;
  if (d.kind === 'intro_request') {
    const p = d.person_id ? getPerson(d.person_id) : null;
    if (!p?.email) return { ok: false, reason: 'Contact has no email address' };
    to = p.email;
  } else {
    const t = d.target_id ? getTarget(d.target_id) : null;
    if (!t) return { ok: false, reason: 'Target not found' };
    if (t.route !== 'email') return { ok: false, reason: 'Target is form-only' };
    if (!t.contact_email) return { ok: false, reason: 'Target has no contact email' };
    if (isSuppressed(t.contact_email, t.domain)) return { ok: false, reason: 'Recipient opted out' };
    if (['declined', 'closed', 'rejected'].includes(t.status) && d.kind !== 'reply') return { ok: false, reason: `Target is ${t.status}` };
    if (d.kind === 'followup') {
      const n = getDb().prepare("SELECT COUNT(*) n FROM drafts WHERE target_id = ? AND kind = 'followup' AND state = 'sent'").get(t.id) as { n: number };
      if (n.n >= 1) return { ok: false, reason: 'Follow-up already sent' };
      const replied = getDb().prepare('SELECT 1 FROM replies WHERE target_id = ? LIMIT 1').get(t.id);
      if (replied) return { ok: false, reason: 'Target already replied' };
    }
    to = t.contact_email;
  }
  if (isSuppressed(to)) return { ok: false, reason: 'Recipient opted out' };
  return { ok: true, to };
}
