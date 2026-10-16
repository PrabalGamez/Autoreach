import { getDb, getSettings, getState, setState, pause } from '../db/index.ts';
import { getProfile, getTarget, setTargetStatus } from '../db/repo.ts';
import { classifyReply } from '../claude/tasks.ts';
import { looksLikeOptOut, suppressContact } from '../compliance.ts';
import { raiseOfferAlert } from '../alerts/offers.ts';
import { gmail, stripQuoted } from './api.ts';
import { GmailAuthError } from './oauth.ts';
import { log } from '../log.ts';

function emailOf(from: string | undefined) {
  if (!from) return null;
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

/** Called once after Gmail connects so we only watch mail that arrives from now on. */
export async function initHistory() {
  const p = await gmail().profile();
  setState('last_history_id', p.historyId);
  return p;
}

export async function pollReplies(): Promise<{ newReplies: number }> {
  const db = getDb();
  const self = (getProfile().sender_email ?? '').toLowerCase();
  let start = getState('last_history_id');
  if (!start) {
    await initHistory();
    return { newReplies: 0 };
  }
  const tracked = new Set((db.prepare("SELECT DISTINCT thread_id FROM messages WHERE thread_id IS NOT NULL AND channel = 'gmail'").all() as { thread_id: string }[]).map((r) => r.thread_id));
  if (!tracked.size) {
    const p = await gmail().profile();
    setState('last_history_id', p.historyId);
    return { newReplies: 0 };
  }

  let candidates: { id: string; threadId: string }[];
  const h = await gmail().history(start);
  if (h === 'expired') {
    // History window expired (laptop off for days): re-scan every tracked thread.
    candidates = [];
    for (const t of tracked) candidates.push(...(await gmail().threadMessageIds(t)));
    const p = await gmail().profile();
    start = p.historyId;
  } else {
    candidates = h.messageIds;
    start = h.historyId;
  }

  let added = 0;
  const known = db.prepare('SELECT 1 FROM replies WHERE gmail_message_id = ? UNION SELECT 1 FROM messages WHERE gmail_message_id = ?');
  for (const c of candidates) {
    if (!tracked.has(c.threadId) || known.get(c.id, c.id)) continue;
    const m = await gmail().getMessage(c.id);
    if (m.labelIds.includes('SENT') || m.labelIds.includes('DRAFT')) continue;
    const from = emailOf(m.headers['from']);
    if (from && self && from === self) continue;
    const ours = db.prepare("SELECT target_id, person_id, subject FROM messages WHERE thread_id = ? AND channel = 'gmail' ORDER BY id ASC LIMIT 1").get(c.threadId) as
      | { target_id: number | null; person_id: number | null; subject: string }
      | undefined;
    const body = stripQuoted(m.text || m.snippet);
    const info = db
      .prepare('INSERT INTO replies (gmail_message_id, thread_id, target_id, person_id, from_email, received_at, snippet, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(m.id, c.threadId, ours?.target_id ?? null, ours?.person_id ?? null, from, new Date(Number(m.internalDate)).toISOString(), m.snippet, body);
    added++;
    await handleReply(Number(info.lastInsertRowid), ours?.subject ?? '');
  }
  setState('last_history_id', start);
  setState('last_poll_at', new Date().toISOString());
  return { newReplies: added };
}

export async function handleReply(replyId: number, ourSubject: string) {
  const db = getDb();
  const r = db.prepare('SELECT * FROM replies WHERE id = ?').get(replyId) as { id: number; target_id: number | null; person_id: number | null; from_email: string | null; body: string };
  const t = r.target_id ? getTarget(r.target_id) : null;

  // Code-level opt-out check runs first and does not depend on the model.
  if (looksLikeOptOut(r.body)) {
    applyOptOut(r.target_id, r.from_email);
    db.prepare("UPDATE replies SET label = 'opt_out', confidence = 1, summary = 'Asked not to be contacted again', classified_at = datetime('now') WHERE id = ?").run(r.id);
    return;
  }

  if (t && ['sent', 'approved', 'draft_ready'].includes(t.status)) setTargetStatus(t.id, 'replied');
  if (r.person_id && r.target_id)
    db.prepare("UPDATE referral_outcomes SET stage = 'intro_made', updated_at = datetime('now') WHERE person_id = ? AND target_id = ? AND stage IN ('suggested','asked')").run(r.person_id, r.target_id);

  const c = await classifyReply({ targetName: t?.name ?? null, ourSubject, from: r.from_email, body: r.body });
  db.prepare("UPDATE replies SET label = ?, confidence = ?, summary = ?, terms = ?, classified_at = datetime('now') WHERE id = ?").run(
    c.label,
    c.confidence,
    c.summary,
    JSON.stringify({ ...c.terms, questions: c.questions }),
    r.id,
  );

  if (c.label === 'opt_out') return applyOptOut(r.target_id, r.from_email);
  if (!t) return;
  if (c.label === 'decline') setTargetStatus(t.id, 'declined');
  if (c.label === 'offer' && c.confidence >= getSettings().offer_confidence) {
    setTargetStatus(t.id, 'offer');
    if (t.referred_by) db.prepare("UPDATE referral_outcomes SET stage = 'offer', updated_at = datetime('now') WHERE person_id = ? AND target_id = ?").run(t.referred_by, t.id);
    await raiseOfferAlert(r.id);
  } else if (t.referred_by && c.label !== 'auto_reply') {
    db.prepare("UPDATE referral_outcomes SET stage = 'replied', updated_at = datetime('now') WHERE person_id = ? AND target_id = ? AND stage NOT IN ('offer')").run(t.referred_by, t.id);
  }
}

function applyOptOut(targetId: number | null, from: string | null) {
  const db = getDb();
  const t = targetId ? getTarget(targetId) : null;
  suppressContact(from, 'Opted out by reply');
  if (t?.contact_email) suppressContact(t.contact_email, 'Opted out by reply');
  if (t) {
    setTargetStatus(t.id, 'declined');
    db.prepare("UPDATE drafts SET state = 'discarded' WHERE target_id = ? AND state IN ('pending','approved','queued')").run(t.id);
    db.prepare('DELETE FROM send_queue WHERE draft_id IN (SELECT id FROM drafts WHERE target_id = ?)').run(t.id);
  }
}

export async function safePoll() {
  try {
    return await pollReplies();
  } catch (err) {
    if (err instanceof GmailAuthError) pause((err as Error).message);
    log.error(`Reply poll failed: ${(err as Error).message}`);
    setState('last_poll_error', (err as Error).message);
    return { newReplies: 0, error: (err as Error).message };
  }
}
