import { getDb } from './db/index.ts';
import {
  getBrief,
  getDraft,
  getPerson,
  getTarget,
  insertDraft,
  otherDraftBodies,
  saveBrief,
  setDraftState,
  setTargetStatus,
  updateTarget,
} from './db/repo.ts';
import { draftFollowup, draftInitial, draftIntroRequest, researchTarget } from './claude/tasks.ts';
import type { DraftOut } from './claude/schemas.ts';
import { checkDraft, withOptOut } from './quality.ts';
import { isSuppressed } from './compliance.ts';
import { log } from './log.ts';
import type { Target } from '../shared/types.ts';

const inFlight = new Set<number>();
export const isBusy = (targetId: number) => inFlight.has(targetId);

/** Run a background job without blocking the request; errors land in ai_jobs + log. */
export function background(label: string, fn: () => Promise<unknown>) {
  fn().catch((err) => log.error(`${label}: ${(err as Error).message}`));
}

async function draftWithChecks(make: (feedback?: string) => Promise<DraftOut>, excludeTargetId: number | null): Promise<DraftOut> {
  const others = otherDraftBodies(excludeTargetId);
  let draft = await make();
  for (let i = 0; i < 2; i++) {
    const problem = checkDraft(draft, others);
    if (!problem) break;
    if (i === 1) {
      getDb().prepare("INSERT INTO ai_jobs (task, target_id, state, error) VALUES ('quality_check', ?, 'failed', ?)").run(excludeTargetId, problem);
      throw new Error(`Draft failed quality checks: ${problem}`);
    }
    draft = await make(problem);
  }
  return { ...draft, body: withOptOut(draft.body) };
}

export async function researchAndDraft(targetId: number) {
  if (inFlight.has(targetId)) return;
  inFlight.add(targetId);
  try {
    let t = getTarget(targetId);
    if (!t) return;
    setTargetStatus(t.id, 'researching');
    const brief = await researchTarget(t);
    saveBrief(t.id, brief);

    // Contact facts from research. Form-only always wins; an email is only filled in if we had none.
    const c = brief.contact;
    const patch: Partial<Target> = {};
    if (c.route === 'form_only') {
      patch.route = 'form_only';
      if (c.form_url) patch.form_url = c.form_url;
    } else if (!t.contact_email && c.contact_email && c.contact_source_url) {
      patch.contact_email = c.contact_email;
      patch.contact_source_url = c.contact_source_url;
      patch.route = 'email';
    }
    if (!t.timezone && c.timezone) patch.timezone = c.timezone;
    t = updateTarget(t.id, patch) ?? t;

    await createInitialDraft(t);
  } finally {
    inFlight.delete(targetId);
  }
}

export async function createInitialDraft(t: Target) {
  const brief = getBrief(t.id);
  const referrer = t.referred_by ? getPerson(t.referred_by) : null;
  const d = await draftWithChecks((feedback) => draftInitial(t, brief, { referrer, feedback }), t.id);
  // Retire any older pending draft for this target.
  getDb().prepare("UPDATE drafts SET state = 'discarded' WHERE target_id = ? AND kind = 'initial' AND state = 'pending'").run(t.id);
  insertDraft({ target_id: t.id, kind: 'initial', subject: d.subject, body: d.body, unique_reference: d.unique_reference, link_used: d.link_used });
  setTargetStatus(t.id, 'draft_ready');
}

export async function regenerateDraft(draftId: number, note?: string) {
  const old = getDraft(draftId);
  if (!old || !['pending', 'skipped'].includes(old.state)) throw new Error('Only drafts awaiting review can be regenerated');
  const t = old.target_id ? getTarget(old.target_id) : null;
  let out: DraftOut;
  if (old.kind === 'intro_request') {
    const person = old.person_id ? getPerson(old.person_id) : null;
    if (!person || !t) throw new Error('Missing contact or target');
    out = await draftWithChecks((fb) => draftIntroRequest(person, t, `${note ?? ''} ${fb ?? ''}`.trim()), null);
  } else {
    if (!t) throw new Error('Target not found');
    const referrer = t.referred_by ? getPerson(t.referred_by) : null;
    const previous: DraftOut = { subject: old.subject, body: old.body, unique_reference: old.unique_reference, link_used: old.link_used };
    out = await draftWithChecks((feedback) => draftInitial(t, getBrief(t.id), { referrer, previous, note, feedback }), t.id);
  }
  setDraftState(old.id, 'discarded');
  return insertDraft({
    target_id: old.target_id,
    person_id: old.person_id,
    kind: old.kind,
    subject: out.subject,
    body: out.body,
    unique_reference: out.unique_reference,
    link_used: out.link_used,
    version: old.version + 1,
    regen_note: note ?? null,
  });
}

/** Create follow-up drafts (for review) for targets that went quiet. Never sends anything. */
export async function createDueFollowups(days: number) {
  const rows = getDb()
    .prepare(
      `SELECT t.id AS target_id, m.subject, d.body
       FROM targets t
       JOIN messages m ON m.target_id = t.id AND m.channel = 'gmail'
       JOIN drafts d ON d.id = m.draft_id AND d.kind = 'initial'
       WHERE t.status = 'sent'
         AND m.sent_at <= datetime('now', ?)
         AND NOT EXISTS (SELECT 1 FROM replies r WHERE r.target_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM drafts f WHERE f.target_id = t.id AND f.kind = 'followup')`,
    )
    .all(`-${days} days`) as { target_id: number; subject: string; body: string }[];
  let created = 0;
  for (const r of rows) {
    const t = getTarget(r.target_id);
    if (!t || isSuppressed(t.contact_email, t.domain)) continue;
    const out = await draftWithChecks(() => draftFollowup(t, { subject: r.subject, body: r.body }), t.id);
    insertDraft({ target_id: t.id, kind: 'followup', subject: out.subject, body: out.body, unique_reference: out.unique_reference, link_used: out.link_used });
    created++;
  }
  return created;
}
