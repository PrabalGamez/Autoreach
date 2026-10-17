import { getDb } from '../db/index.ts';
import { getDraft, getProfile, getTarget, setDraftState, setTargetStatus } from '../db/repo.ts';
import { canSend } from '../compliance.ts';
import { gmail } from './api.ts';
import { composeUrl } from './compose.ts';

function encodeHeader(v: string) {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

function wrap76(b64: string) {
  return b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

export interface MimeInput {
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string | null;
  listUnsubscribe?: boolean;
}

export function buildMime(m: MimeInput): string {
  const headers = [
    `From: ${encodeHeader(m.fromName)} <${m.fromEmail}>`,
    `To: ${m.to}`,
    `Subject: ${encodeHeader(m.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  if (m.inReplyTo) headers.push(`In-Reply-To: ${m.inReplyTo}`, `References: ${m.inReplyTo}`);
  if (m.listUnsubscribe) headers.push(`List-Unsubscribe: <mailto:${m.fromEmail}?subject=unsubscribe>`);
  const raw = `${headers.join('\r\n')}\r\n\r\n${wrap76(Buffer.from(m.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64'))}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function footer(address: string) {
  return address.trim() ? `\n\n--\n${address.trim()}` : '';
}

/** Sends one approved draft. Every check runs here, right before the network call. */
export async function sendDraft(draftId: number) {
  const check = canSend(draftId);
  if (!check.ok || !check.to) throw new Error(check.reason ?? 'Blocked');
  const d = getDraft(draftId)!;
  const p = getProfile();
  if (!p.sender_email) throw new Error('Sender email unknown. Reconnect Gmail.');

  // Follow-ups and offer replies go into the existing thread.
  let threadId: string | undefined;
  let inReplyTo: string | null = null;
  if (d.kind === 'followup' || d.kind === 'reply') {
    const prev = getDb()
      .prepare("SELECT thread_id, rfc_message_id FROM messages WHERE target_id = ? AND channel = 'gmail' ORDER BY id DESC LIMIT 1")
      .get(d.target_id) as { thread_id: string; rfc_message_id: string | null } | undefined;
    if (d.kind === 'reply') {
      const r = getDb().prepare('SELECT thread_id FROM replies WHERE target_id = ? ORDER BY id DESC LIMIT 1').get(d.target_id) as { thread_id: string } | undefined;
      threadId = r?.thread_id ?? prev?.thread_id;
    } else threadId = prev?.thread_id;
    inReplyTo = prev?.rfc_message_id ?? null;
  }

  const raw = buildMime({
    fromName: p.alias || p.real_name || p.sender_email,
    fromEmail: p.sender_email,
    to: check.to,
    subject: d.subject,
    body: d.body + (d.kind === 'initial' || d.kind === 'followup' ? footer(p.postal_address) : ''),
    inReplyTo,
    listUnsubscribe: d.kind === 'initial' || d.kind === 'followup',
  });
  const res = await gmail().sendRaw(raw, threadId);
  let rfcId: string | null = null;
  try {
    const meta = await gmail().getMessage(res.id);
    rfcId = meta.headers['message-id'] ?? null;
  } catch {
    /* non-fatal */
  }
  recordSent(d.id, check.to, { gmailId: res.id, rfcId, threadId: res.threadId });
  return res;
}

/** Bookkeeping after an email leaves (automatic mode) or is handed to Gmail's compose window (web mode). */
export function recordSent(draftId: number, to: string, ids: { gmailId: string | null; rfcId: string | null; threadId: string | null }) {
  const d = getDraft(draftId)!;
  getDb()
    .prepare('INSERT INTO messages (draft_id, target_id, person_id, channel, gmail_message_id, rfc_message_id, thread_id, to_email, subject) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(d.id, d.target_id, d.person_id, 'gmail', ids.gmailId, ids.rfcId, ids.threadId, to, d.subject);
  getDb().prepare('DELETE FROM send_queue WHERE draft_id = ?').run(d.id);
  setDraftState(d.id, 'sent');
  if (d.target_id && (d.kind === 'initial' || d.kind === 'followup')) {
    const t = getTarget(d.target_id);
    if (t && ['approved', 'draft_ready', 'researching'].includes(t.status)) setTargetStatus(t.id, 'sent');
  }
  if (d.kind === 'intro_request' && d.person_id && d.target_id) {
    getDb().prepare("UPDATE referral_outcomes SET stage = 'asked', updated_at = datetime('now') WHERE person_id = ? AND target_id = ? AND stage = 'suggested'").run(d.person_id, d.target_id);
  }
}

/**
 * Gmail web mode: run every send check, record the email as sent, and return the Gmail compose link.
 * The person presses Send in Gmail themselves.
 */
export function handOffToGmail(draftId: number): { url: string; to: string } {
  const check = canSend(draftId);
  if (!check.ok || !check.to) throw new Error(check.reason ?? 'Blocked');
  const d = getDraft(draftId)!;
  const p = getProfile();
  if (!p.sender_email) throw new Error('Add your Gmail address first.');
  const body = d.body + (d.kind === 'initial' || d.kind === 'followup' ? footer(p.postal_address) : '');
  recordSent(d.id, check.to, { gmailId: null, rfcId: null, threadId: null });
  return { url: composeUrl({ from: p.sender_email, to: check.to, subject: d.subject, body }), to: check.to };
}

/** Alert email from you to you. */
export async function sendToSelf(subject: string, body: string) {
  const p = getProfile();
  if (!p.sender_email) throw new Error('Sender email unknown');
  const raw = buildMime({ fromName: 'Autoreach', fromEmail: p.sender_email, to: p.sender_email, subject, body });
  return gmail().sendRaw(raw);
}
