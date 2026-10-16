import { execFile } from 'node:child_process';
import { getDb, getSettings, parseJson } from '../db/index.ts';
import { sendToSelf } from '../gmail/send.ts';
import { log } from '../log.ts';
import { ORIGIN } from '../config.ts';
import type { OfferAlert, Terms } from '../../shared/types.ts';

export const NOT_LEGAL_ADVICE =
  'Autoreach is not legal advice. Have any contract reviewed (ideally by a music lawyer) before you sign.';

function desktopNotify(title: string, message: string) {
  if (process.platform !== 'darwin' || process.env.VITEST) return;
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  execFile('osascript', ['-e', `display notification "${esc(message)}" with title "${esc(title)}" sound name "Glass"`], () => {});
}

export async function raiseOfferAlert(replyId: number) {
  const db = getDb();
  const exists = db.prepare('SELECT id FROM offer_alerts WHERE reply_id = ?').get(replyId);
  if (exists) return;
  db.prepare('INSERT INTO offer_alerts (reply_id) VALUES (?)').run(replyId);
  const a = getAlertByReply(replyId)!;
  const s = getSettings();
  const errors: string[] = [];
  const name = a.target_name ?? a.from_email ?? 'unknown sender';

  if (s.alert_email) {
    const t = a.terms;
    const body = [
      `${name} replied with what looks like an offer.`,
      '',
      `Summary: ${a.summary ?? ''}`,
      '',
      'Key terms:',
      `- Money: ${t?.money ?? 'not stated'}`,
      `- Rights: ${t?.rights ?? 'not stated'}`,
      `- Term length: ${t?.term_length ?? 'not stated'}`,
      `- Exclusivity: ${t?.exclusivity ?? 'not stated'}`,
      ...(t?.other ?? []).map((o) => `- ${o}`),
      '',
      a.questions.length ? `Worth asking before you agree:\n${a.questions.map((q) => `- ${q}`).join('\n')}\n` : '',
      `Thread: https://mail.google.com/mail/u/0/#all/${a.thread_id}`,
      `Autoreach: ${ORIGIN}`,
      '',
      NOT_LEGAL_ADVICE,
    ].join('\n');
    try {
      await sendToSelf(`🔥 Autoreach: offer from ${name}`, body);
      db.prepare("UPDATE offer_alerts SET email_sent_at = datetime('now') WHERE id = ?").run(a.id);
    } catch (err) {
      errors.push(`email: ${(err as Error).message}`);
    }
  }
  if (s.alert_desktop) {
    desktopNotify('Autoreach: offer received', `${name}: ${a.summary ?? 'Open Autoreach to review.'}`);
    db.prepare("UPDATE offer_alerts SET notified_at = datetime('now') WHERE id = ?").run(a.id);
  }
  if (errors.length) {
    db.prepare('UPDATE offer_alerts SET channel_errors = ? WHERE id = ?').run(errors.join('; '), a.id);
    log.error(`Offer alert channel errors: ${errors.join('; ')}`);
  }
}

const ALERT_SELECT = `
  SELECT a.*, r.target_id, r.from_email, r.summary, r.confidence, r.terms, r.thread_id, r.body, r.received_at, t.name AS target_name
  FROM offer_alerts a JOIN replies r ON r.id = a.reply_id LEFT JOIN targets t ON t.id = r.target_id`;

function mapAlert(r: Record<string, unknown>): OfferAlert {
  const terms = parseJson<(Terms & { questions?: string[] }) | null>(r.terms as string, null);
  return {
    id: r.id as number,
    reply_id: r.reply_id as number,
    target_id: (r.target_id as number) ?? null,
    target_name: (r.target_name as string) ?? null,
    from_email: (r.from_email as string) ?? null,
    summary: (r.summary as string) ?? null,
    confidence: (r.confidence as number) ?? null,
    terms: terms ? { money: terms.money, rights: terms.rights, term_length: terms.term_length, exclusivity: terms.exclusivity, other: terms.other ?? [] } : null,
    questions: terms?.questions ?? [],
    thread_id: r.thread_id as string,
    body: (r.body as string) ?? '',
    received_at: (r.received_at as string) ?? null,
    acknowledged_at: (r.acknowledged_at as string) ?? null,
    handled_at: (r.handled_at as string) ?? null,
    created_at: r.created_at as string,
  };
}

export function getAlertByReply(replyId: number) {
  const r = getDb().prepare(`${ALERT_SELECT} WHERE a.reply_id = ?`).get(replyId) as Record<string, unknown> | undefined;
  return r ? mapAlert(r) : null;
}
export function getAlert(id: number) {
  const r = getDb().prepare(`${ALERT_SELECT} WHERE a.id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? mapAlert(r) : null;
}
export function pendingAlerts(): OfferAlert[] {
  return (getDb().prepare(`${ALERT_SELECT} WHERE a.acknowledged_at IS NULL ORDER BY a.id ASC`).all() as Record<string, unknown>[]).map(mapAlert);
}
export function allAlerts(): OfferAlert[] {
  return (getDb().prepare(`${ALERT_SELECT} ORDER BY a.id DESC`).all() as Record<string, unknown>[]).map(mapAlert);
}
export function acknowledge(id: number) {
  getDb().prepare("UPDATE offer_alerts SET acknowledged_at = COALESCE(acknowledged_at, datetime('now')) WHERE id = ?").run(id);
}
export function markHandled(id: number) {
  getDb().prepare("UPDATE offer_alerts SET handled_at = datetime('now'), acknowledged_at = COALESCE(acknowledged_at, datetime('now')) WHERE id = ?").run(id);
}
