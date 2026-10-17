import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/index.ts';
import {
  getBrief, getDraft, getPerson, getTarget, insertTarget, listPeople, listTargets, setDraftState, setTargetStatus, updateTarget,
} from '../db/repo.ts';
import { proposeTargets, matchIntros, draftIntroRequest } from '../claude/tasks.ts';
import { background, isBusy, regenerateDraft, researchAndDraft } from '../pipeline.ts';
import { checkDraft, withOptOut } from '../quality.ts';
import { isSuppressed, suppress, suppressContact } from '../compliance.ts';
import { enqueue, sentToday } from '../jobs/scheduler.ts';
import { handOffToGmail } from '../gmail/send.ts';
import { sendMode } from '../gmail/oauth.ts';
import { handleReply } from '../gmail/watch.ts';
import { getSettings } from '../db/index.ts';
import type { ReviewCard, Target, TargetStatus } from '../../shared/types.ts';
import { PIPELINE_STATUSES } from '../../shared/types.ts';

const Kind = z.enum(['label', 'brand', 'collaborator', 'other']);
const optUrl = z.string().url().nullable().optional().or(z.literal('').transform(() => null));
const optEmail = z.string().email().nullable().optional().or(z.literal('').transform(() => null));

const ManualTarget = z.object({
  name: z.string().min(1).max(120),
  kind: Kind.default('label'),
  domain: z.string().max(200).nullable().optional(),
  contact_email: optEmail,
  contact_source_url: optUrl,
  route: z.enum(['email', 'form_only']).optional(),
  form_url: optUrl,
  timezone: z.string().max(60).nullable().optional(),
  referred_by: z.number().int().nullable().optional(),
  notes: z.string().max(1000).default(''),
});

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, commas and newlines in quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') row.push(cell.trim()), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function importRows(text: string) {
  const rows = parseCsv(text);
  if (!rows.length) return { added: [] as Target[], duplicates: [] as string[], skipped: [] as string[] };
  let header = rows[0].map((h) => h.toLowerCase());
  const hasHeader = header.includes('name');
  if (!hasHeader) header = ['name', 'contact', 'notes'];
  const idx = (k: string) => header.indexOf(k);
  const added: Target[] = [];
  const duplicates: string[] = [];
  const skipped: string[] = [];
  for (const r of hasHeader ? rows.slice(1) : rows) {
    const name = r[idx('name')]?.trim();
    if (!name) continue;
    const contact = (r[idx('contact')] ?? r[idx('email')] ?? '').trim();
    const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact);
    const isUrl = /^https?:\/\//i.test(contact);
    const domain = r[idx('domain')] || (isUrl ? contact : null);
    if (isEmail && isSuppressed(contact)) {
      skipped.push(`${name} (opted out)`);
      continue;
    }
    const res = insertTarget({
      name,
      kind: (Kind.safeParse(r[idx('kind')]).data ?? 'label') as Target['kind'],
      domain,
      contact_email: isEmail ? contact : null,
      route: isEmail ? 'email' : 'form_only',
      form_url: !isEmail && isUrl ? contact : null,
      origin: 'csv',
      notes: r[idx('notes')] ?? '',
    });
    if (res.duplicate) duplicates.push(name);
    else added.push(res.target);
  }
  return { added, duplicates, skipped };
}

function reviewCards(): ReviewCard[] {
  const drafts = getDb()
    .prepare("SELECT id FROM drafts WHERE state IN ('pending','skipped') ORDER BY CASE WHEN kind = 'reply' THEN 0 ELSE 1 END, CASE state WHEN 'pending' THEN 0 ELSE 1 END, id ASC")
    .all() as { id: number }[];
  return drafts.map(({ id }) => {
    const draft = getDraft(id)!;
    const target = draft.target_id ? getTarget(draft.target_id) : null;
    const person = draft.person_id ? getPerson(draft.person_id) : null;
    const to = draft.kind === 'intro_request' ? (person?.email ?? null) : target?.route === 'email' ? target.contact_email : null;
    return { draft, target, brief: target ? getBrief(target.id) : null, person, to };
  });
}

export async function targetRoutes(app: FastifyInstance) {
  app.get('/api/targets', async (req) => {
    const status = (req.query as Record<string, string>).status as TargetStatus | undefined;
    return listTargets(status).map((t) => ({ ...t, busy: isBusy(t.id) }));
  });

  app.get('/api/targets/:id', async (req, reply) => {
    const t = getTarget(Number((req.params as { id: string }).id));
    if (!t) return reply.code(404).send({ error: 'Not found' });
    return { target: t, brief: getBrief(t.id) };
  });

  app.post('/api/targets', async (req, reply) => {
    const b = ManualTarget.parse(req.body);
    if (b.contact_email && isSuppressed(b.contact_email, b.domain)) return reply.code(409).send({ error: 'This contact opted out. Autoreach will not contact them again.' });
    const res = insertTarget({ ...b, origin: 'manual' });
    if (res.duplicate) return reply.code(409).send({ error: `Already on your list as "${res.target.name}".`, target: res.target });
    background(`research ${res.target.id}`, () => researchAndDraft(res.target.id));
    return res.target;
  });

  app.post('/api/targets/import', async (req) => {
    const { text } = z.object({ text: z.string().min(1).max(500_000) }).parse(req.body);
    const out = importRows(text);
    for (const t of out.added) background(`research ${t.id}`, () => researchAndDraft(t.id));
    return out;
  });

  /** "Ask Autoreach": proposals land as status=proposed for one-by-one approval. */
  app.post('/api/targets/propose', async (req) => {
    const { query } = z.object({ query: z.string().min(5).max(500) }).parse(req.body);
    background('propose', async () => {
      const existing = listTargets().map((t) => t.name);
      const { proposals } = await proposeTargets(query, existing);
      for (const p of proposals) {
        if (p.contact_email && isSuppressed(p.contact_email, p.domain)) continue;
        insertTarget({
          name: p.name,
          kind: p.kind,
          domain: p.domain,
          contact_email: p.route === 'email' ? p.contact_email : null,
          contact_source_url: p.contact_source_url,
          route: p.route === 'email' && p.contact_email ? 'email' : 'form_only',
          form_url: p.form_url,
          origin: 'ai',
          why_fit: p.why_fit,
          proposal_sources: p.sources,
          status: 'proposed',
          notes: `Proposed for: ${query}`,
        });
      }
    });
    return { started: true };
  });

  app.post('/api/targets/:id/accept', async (req, reply) => {
    const t = getTarget(Number((req.params as { id: string }).id));
    if (!t || t.status !== 'proposed') return reply.code(400).send({ error: 'Not a proposal' });
    setTargetStatus(t.id, 'researching');
    background(`research ${t.id}`, () => researchAndDraft(t.id));
    return getTarget(t.id);
  });

  app.post('/api/targets/:id/reject', async (req) => {
    const id = Number((req.params as { id: string }).id);
    setTargetStatus(id, 'rejected');
    return getTarget(id);
  });

  app.post('/api/targets/:id/research', async (req, reply) => {
    const t = getTarget(Number((req.params as { id: string }).id));
    if (!t) return reply.code(404).send({ error: 'Not found' });
    if (isBusy(t.id)) return reply.code(409).send({ error: 'Already researching' });
    background(`research ${t.id}`, () => researchAndDraft(t.id));
    return { started: true };
  });

  app.patch('/api/targets/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = ManualTarget.partial().extend({ status: z.enum(PIPELINE_STATUSES as [TargetStatus, ...TargetStatus[]]).optional() }).parse(req.body);
    const t = updateTarget(id, b as Partial<Target>);
    if (!t) return reply.code(404).send({ error: 'Not found' });
    if (b.referred_by)
      getDb().prepare("INSERT OR IGNORE INTO referral_outcomes (person_id, target_id, stage, reason) VALUES (?, ?, 'intro_made', 'Set as referrer')").run(b.referred_by, id);
    return t;
  });

  /** Paste a reply you got in Gmail. Claude reads it: offers raise the alert, opt-outs are honoured. */
  app.post('/api/targets/:id/reply', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const t = getTarget(id);
    if (!t) return reply.code(404).send({ error: 'Not found' });
    const { text } = z.object({ text: z.string().trim().min(2).max(20000) }).parse(req.body);
    const last = getDb().prepare("SELECT subject FROM messages WHERE target_id = ? ORDER BY id DESC LIMIT 1").get(id) as { subject: string } | undefined;
    const info = getDb()
      .prepare('INSERT INTO replies (thread_id, target_id, from_email, received_at, snippet, body) VALUES (?, ?, ?, ?, ?, ?)')
      .run(`manual-${id}`, id, t.contact_email, new Date().toISOString(), text.slice(0, 140), text);
    await handleReply(Number(info.lastInsertRowid), last?.subject ?? '');
    return getDb().prepare('SELECT id, label, confidence, summary FROM replies WHERE id = ?').get(Number(info.lastInsertRowid));
  });

  /** Manual opt-out (e.g. they asked by phone). Permanent. */
  app.post('/api/targets/:id/opt-out', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const t = getTarget(id);
    if (t?.contact_email) suppressContact(t.contact_email, 'Marked opted out manually');
    else if (t?.domain) suppress(t.domain, 'Marked opted out manually');
    setTargetStatus(id, 'declined');
    getDb().prepare("UPDATE drafts SET state = 'discarded' WHERE target_id = ? AND state IN ('pending','skipped','approved','queued')").run(id);
    getDb().prepare('DELETE FROM send_queue WHERE draft_id IN (SELECT id FROM drafts WHERE target_id = ?)').run(id);
    return getTarget(id);
  });

  app.delete('/api/targets/:id', async (req) => {
    getDb().prepare('DELETE FROM targets WHERE id = ?').run(Number((req.params as { id: string }).id));
    return { ok: true };
  });

  // ---- review ----
  app.get('/api/review', async () => reviewCards());

  const DraftEdit = z.object({ subject: z.string().min(3).max(150), body: z.string().min(10).max(5000) });

  app.patch('/api/drafts/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const d = getDraft(id);
    if (!d || !['pending', 'skipped'].includes(d.state)) return reply.code(400).send({ error: 'Draft is not editable' });
    const b = DraftEdit.parse(req.body);
    getDb().prepare('UPDATE drafts SET subject = ?, body = ? WHERE id = ?').run(b.subject, b.body, id);
    return getDraft(id);
  });

  /** Explicit, single-draft approval. There is deliberately no bulk endpoint. */
  app.post('/api/drafts/:id/approve', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const d = getDraft(id);
    if (!d || !['pending', 'skipped'].includes(d.state)) return reply.code(400).send({ error: 'Draft is not awaiting review' });
    const b = DraftEdit.partial().parse(req.body ?? {});
    const subject = b.subject ?? d.subject;
    const body = d.kind === 'initial' || d.kind === 'followup' ? withOptOut(b.body ?? d.body) : (b.body ?? d.body);
    getDb().prepare('UPDATE drafts SET subject = ?, body = ? WHERE id = ?').run(subject, body, id);
    const t = d.target_id ? getTarget(d.target_id) : null;

    if (d.kind !== 'intro_request' && t?.route === 'form_only') {
      // You submit form-only targets yourself; approving records it.
      setDraftState(id, 'submitted_form');
      getDb().prepare("INSERT INTO messages (draft_id, target_id, channel, subject) VALUES (?, ?, 'form', ?)").run(id, t.id, subject);
      setTargetStatus(t.id, 'sent');
      return { draft: getDraft(id), formUrl: t.form_url };
    }
    if (d.kind === 'intro_request') {
      const p = d.person_id ? getPerson(d.person_id) : null;
      if (!p?.email) return reply.code(400).send({ error: `${p?.name ?? 'This contact'} has no email. Add one in Referrals, or copy the text and send it yourself.` });
    } else {
      if (!t?.contact_email) return reply.code(400).send({ error: 'No contact email for this target.' });
      if (isSuppressed(t.contact_email, t.domain)) return reply.code(409).send({ error: 'This contact opted out.' });
    }
    if (sendMode() === 'gmail_web') {
      // Same checks as automatic sending, then hand the email to Gmail's compose window. You press Send there.
      if (sentToday() >= getSettings().daily_cap) return reply.code(409).send({ error: `Daily limit reached (${getSettings().daily_cap}). It protects your sender reputation; change it in Settings.` });
      setDraftState(id, 'approved');
      try {
        const { url, to } = handOffToGmail(id);
        return { draft: getDraft(id), composeUrl: url, to };
      } catch (e) {
        getDb().prepare("UPDATE drafts SET state = 'pending', approved_at = NULL WHERE id = ?").run(id);
        return reply.code(409).send({ error: (e as Error).message });
      }
    }
    setDraftState(id, 'approved');
    enqueue(id);
    if (t && d.kind === 'initial') setTargetStatus(t.id, 'approved');
    return { draft: getDraft(id) };
  });

  app.post('/api/drafts/:id/skip', async (req) => {
    const id = Number((req.params as { id: string }).id);
    getDb().prepare("UPDATE drafts SET state = 'skipped' WHERE id = ? AND state IN ('pending','skipped')").run(id);
    return getDraft(id);
  });

  app.post('/api/drafts/:id/discard', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const d = getDraft(id);
    getDb().prepare("UPDATE drafts SET state = 'discarded' WHERE id = ? AND state IN ('pending','skipped')").run(id);
    if (d?.target_id && d.kind === 'initial') {
      const t = getTarget(d.target_id);
      if (t?.status === 'draft_ready') setTargetStatus(t.id, 'closed');
    }
    return getDraft(id);
  });

  /** Pull an approved draft back out of the send queue before it goes. */
  app.post('/api/drafts/:id/unqueue', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const d = getDraft(id);
    if (!d || d.state !== 'queued') return reply.code(400).send({ error: 'Not queued' });
    getDb().prepare('DELETE FROM send_queue WHERE draft_id = ?').run(id);
    getDb().prepare("UPDATE drafts SET state = 'pending', approved_at = NULL WHERE id = ?").run(id);
    if (d.target_id && d.kind === 'initial') setTargetStatus(d.target_id, 'draft_ready');
    return getDraft(id);
  });

  app.post('/api/drafts/:id/regenerate', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const { note } = z.object({ note: z.string().max(300).optional() }).parse(req.body ?? {});
    return regenerateDraft(id, note || undefined);
  });

  app.get('/api/queue', async () =>
    getDb()
      .prepare(
        `SELECT q.*, d.subject, d.kind, t.name AS target_name, p.name AS person_name FROM send_queue q JOIN drafts d ON d.id = q.draft_id
         LEFT JOIN targets t ON t.id = d.target_id LEFT JOIN people p ON p.id = d.person_id ORDER BY q.enqueued_at`,
      )
      .all(),
  );

  // ---- people & referrals ----
  app.get('/api/people', async () => listPeople());
  app.post('/api/people', async (req) => {
    const b = z.object({ name: z.string().min(1).max(80), email: optEmail, relationship: z.string().max(120).default(''), notes: z.string().max(1000).default('') }).parse(req.body);
    const info = getDb().prepare('INSERT INTO people (name, email, relationship, notes) VALUES (?, ?, ?, ?)').run(b.name, b.email ?? null, b.relationship, b.notes);
    return getPerson(Number(info.lastInsertRowid));
  });
  app.patch('/api/people/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const b = z.object({ name: z.string().min(1).max(80), email: optEmail, relationship: z.string().max(120), notes: z.string().max(1000) }).partial().parse(req.body);
    const cur = getPerson(id)!;
    getDb().prepare('UPDATE people SET name = ?, email = ?, relationship = ?, notes = ? WHERE id = ?').run(b.name ?? cur.name, b.email === undefined ? cur.email : b.email, b.relationship ?? cur.relationship, b.notes ?? cur.notes, id);
    return getPerson(id);
  });
  app.delete('/api/people/:id', async (req) => {
    getDb().prepare('DELETE FROM people WHERE id = ?').run(Number((req.params as { id: string }).id));
    return { ok: true };
  });

  app.post('/api/referrals/suggest', async (_req, reply) => {
    const people = listPeople();
    const targets = listTargets().filter((t) => !['proposed', 'rejected', 'closed', 'declined', 'offer'].includes(t.status) && !t.referred_by);
    if (!people.length || !targets.length) return reply.code(400).send({ error: 'Add at least one contact and one target first.' });
    background('intro_match', async () => {
      const { suggestions } = await matchIntros(people, targets);
      for (const s of suggestions) {
        const person = getPerson(s.person_id);
        const t = getTarget(s.target_id);
        if (!person || !t) continue;
        const ins = getDb().prepare('INSERT OR IGNORE INTO referral_outcomes (person_id, target_id, stage, reason) VALUES (?, ?, ?, ?)').run(person.id, t.id, 'suggested', s.reason);
        if (!ins.changes || s.confidence === 'low') continue;
        const d = await draftIntroRequest(person, t, s.reason);
        if (checkDraft(d, [], 120)) continue;
        getDb().prepare("INSERT INTO drafts (target_id, person_id, kind, subject, body, unique_reference, link_used) VALUES (?, ?, 'intro_request', ?, ?, ?, ?)").run(t.id, person.id, d.subject, d.body, d.unique_reference, d.link_used);
      }
    });
    return { started: true };
  });

  app.get('/api/referrals', async () =>
    getDb()
      .prepare(
        `SELECT ro.*, p.name AS person_name, t.name AS target_name, t.status AS target_status FROM referral_outcomes ro
         JOIN people p ON p.id = ro.person_id JOIN targets t ON t.id = ro.target_id ORDER BY ro.updated_at DESC`,
      )
      .all(),
  );

  app.patch('/api/referrals/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const { stage } = z.object({ stage: z.enum(['suggested', 'asked', 'intro_made', 'replied', 'offer', 'none']) }).parse(req.body);
    getDb().prepare("UPDATE referral_outcomes SET stage = ?, updated_at = datetime('now') WHERE id = ?").run(stage, id);
    const ro = getDb().prepare('SELECT * FROM referral_outcomes WHERE id = ?').get(id) as { person_id: number; target_id: number };
    // An intro that happened makes the target warm: future drafts open with the referral.
    if (stage === 'intro_made') updateTarget(ro.target_id, { referred_by: ro.person_id });
    return ro;
  });
}
