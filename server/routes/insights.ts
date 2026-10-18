import type { SQLInputValue } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DB_PATH, FAKE_GMAIL } from '../config.ts';
import { getDb, getState } from '../db/index.ts';
import { getTarget, insertDraft, listTargets } from '../db/repo.ts';
import { acknowledge, allAlerts, getAlert, markHandled, NOT_LEGAL_ADVICE, pendingAlerts } from '../alerts/offers.ts';
import { draftOfferReply } from '../claude/tasks.ts';
import { deleteAllSecrets } from '../secrets.ts';
import { fakeGmail } from '../gmail/api.ts';
import { pollReplies } from '../gmail/watch.ts';
import { PIPELINE_STATUSES } from '../../shared/types.ts';
import { healthPayload } from './core.ts';

export function dashboardStats() {
  const db = getDb();
  const one = <T>(sql: string, ...args: SQLInputValue[]) => db.prepare(sql).get(...args) as T;
  const sent = one<{ n: number }>("SELECT COUNT(DISTINCT target_id) n FROM messages WHERE channel IN ('gmail','form') AND target_id IS NOT NULL").n;
  const replied = one<{ n: number }>("SELECT COUNT(DISTINCT target_id) n FROM replies WHERE target_id IS NOT NULL AND label IS NOT 'auto_reply'").n;
  const offers = one<{ n: number }>("SELECT COUNT(*) n FROM replies WHERE label = 'offer'").n;
  const interested = one<{ n: number }>("SELECT COUNT(DISTINCT target_id) n FROM replies WHERE label = 'interested'").n;
  const byDay = db
    .prepare("SELECT date(sent_at, 'localtime') d, COUNT(*) n FROM messages WHERE channel = 'gmail' AND sent_at >= datetime('now', '-84 days') GROUP BY d")
    .all() as { d: string; n: number }[];
  const subjects = db
    .prepare(
      `SELECT m.subject, t.name AS target_name, r.label FROM messages m JOIN drafts d ON d.id = m.draft_id AND d.kind = 'initial'
       LEFT JOIN targets t ON t.id = m.target_id
       LEFT JOIN replies r ON r.id = (SELECT id FROM replies WHERE target_id = m.target_id AND label IS NOT 'auto_reply' ORDER BY id LIMIT 1)
       ORDER BY m.id DESC LIMIT 200`,
    )
    .all() as { subject: string; target_name: string; label: string | null }[];
  const warm = db
    .prepare(
      `SELECT CASE WHEN t.referred_by IS NULL THEN 'cold' ELSE 'warm' END k, COUNT(DISTINCT m.target_id) sent,
        COUNT(DISTINCT r.target_id) replied FROM messages m JOIN targets t ON t.id = m.target_id
        LEFT JOIN replies r ON r.target_id = t.id AND r.label IS NOT 'auto_reply' WHERE m.channel IN ('gmail','form') GROUP BY k`,
    )
    .all() as { k: string; sent: number; replied: number }[];
  const deals = db
    .prepare(
      `SELECT je.value ->> '$.type' AS type, COUNT(DISTINCT b.target_id) targets, COUNT(DISTINCT r.target_id) replied
       FROM briefs b, json_each(b.possible_deals) je
       JOIN messages m ON m.target_id = b.target_id
       LEFT JOIN replies r ON r.target_id = b.target_id AND r.label IN ('offer','interested')
       GROUP BY type ORDER BY replied DESC, targets DESC LIMIT 6`,
    )
    .all() as { type: string; targets: number; replied: number }[];
  return {
    sent,
    replied,
    replyRate: sent ? replied / sent : 0,
    offers,
    interested,
    byDay,
    bestSubjects: subjects.filter((s) => s.label && s.label !== 'decline').slice(0, 6),
    recentSubjects: subjects.slice(0, 8),
    warmVsCold: warm,
    angles: deals,
    queue: healthPayload().queue,
  };
}

export async function insightRoutes(app: FastifyInstance, opts: { onShutdown: () => void }) {
  app.get('/api/pipeline', async () => {
    const all = listTargets();
    return PIPELINE_STATUSES.map((s) => ({ status: s, targets: all.filter((t) => t.status === s) }));
  });

  app.get('/api/dashboard', async () => dashboardStats());

  app.get('/api/replies', async () =>
    getDb().prepare('SELECT r.id, r.thread_id, r.target_id, r.from_email, r.received_at, r.label, r.confidence, r.summary, t.name AS target_name FROM replies r LEFT JOIN targets t ON t.id = r.target_id ORDER BY r.id DESC LIMIT 100').all(),
  );

  // ---- offer alerts ----
  app.get('/api/alerts', async () => ({ pending: pendingAlerts(), all: allAlerts(), notice: NOT_LEGAL_ADVICE }));
  app.post('/api/alerts/:id/ack', async (req) => {
    acknowledge(Number((req.params as { id: string }).id));
    return { pending: pendingAlerts() };
  });
  app.post('/api/alerts/:id/handled', async (req) => {
    markHandled(Number((req.params as { id: string }).id));
    return { pending: pendingAlerts() };
  });
  app.post('/api/alerts/:id/draft-reply', async (req, reply) => {
    const a = getAlert(Number((req.params as { id: string }).id));
    if (!a) return reply.code(404).send({ error: 'Not found' });
    const t = a.target_id ? getTarget(a.target_id) : null;
    const d = await draftOfferReply(t, a.body, a.summary ?? '');
    acknowledge(a.id);
    return insertDraft({ target_id: a.target_id, kind: 'reply', subject: d.subject.startsWith('Re:') ? d.subject : `Re: ${d.subject}`, body: d.body, unique_reference: d.unique_reference, link_used: d.link_used });
  });

  // ---- CLI status ----
  app.get('/api/status', async () => {
    const h = healthPayload();
    const counts = getDb().prepare("SELECT status, COUNT(*) n FROM targets WHERE status != 'rejected' GROUP BY status").all() as { status: string; n: number }[];
    const toReview = (getDb().prepare("SELECT COUNT(*) n FROM drafts WHERE state IN ('pending','skipped')").get() as { n: number }).n;
    return {
      health: h,
      counts,
      toReview,
      offers: pendingAlerts().map((a) => ({ id: a.id, name: a.target_name ?? a.from_email, summary: a.summary, terms: a.terms })),
      lastPoll: getState('last_poll_at'),
    };
  });

  // ---- data export / delete ----
  app.get('/api/export', async (_req, reply) => {
    const db = getDb();
    const tables = ['profile', 'settings', 'people', 'targets', 'briefs', 'drafts', 'messages', 'replies', 'offer_alerts', 'suppression', 'referral_outcomes'];
    const out = Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()]));
    reply.header('content-disposition', `attachment; filename="autoreach-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return { exported_at: new Date().toISOString(), ...out };
  });

  app.post('/api/data/delete', async (req, reply) => {
    const { confirm } = z.object({ confirm: z.string() }).parse(req.body);
    if (confirm !== 'DELETE') return reply.code(400).send({ error: 'Type DELETE to confirm.' });
    const db = getDb();
    // Suppression list is kept on purpose: opted-out contacts must never be contacted again.
    for (const t of ['offer_alerts', 'replies', 'send_queue', 'messages', 'drafts', 'briefs', 'referral_outcomes', 'targets', 'people', 'ai_jobs', 'settings', 'system_state']) db.prepare(`DELETE FROM ${t}`).run();
    db.prepare("UPDATE profile SET alias='', real_name='', pitch='', niches='[]', links='[]', best_works='[]', goals='[]', voice_samples='[]', voice_profile=NULL, sender_email=NULL, postal_address='', onboarded_at=NULL WHERE id = 1").run();
    deleteAllSecrets();
    return { ok: true, keptSuppression: true, db: DB_PATH };
  });

  app.post('/api/shutdown', async () => {
    setTimeout(opts.onShutdown, 100);
    return { ok: true };
  });

  // ---- demo / test helpers (only with AUTOREACH_FAKE_GMAIL=1) ----
  if (FAKE_GMAIL) {
    app.post('/api/dev/fake-reply', async (req, reply) => {
      const b = z.object({ targetId: z.number().int(), text: z.string().min(1) }).parse(req.body);
      const m = getDb().prepare("SELECT thread_id, to_email, subject FROM messages WHERE target_id = ? AND channel = 'gmail' ORDER BY id DESC LIMIT 1").get(b.targetId) as
        | { thread_id: string; to_email: string; subject: string }
        | undefined;
      if (!m) return reply.code(400).send({ error: 'Nothing sent to that target yet' });
      fakeGmail.inject({ threadId: m.thread_id, from: m.to_email, subject: `Re: ${m.subject}`, text: b.text });
      return pollReplies();
    });
    app.get('/api/dev/outbox', async () => fakeGmail.sent().map((m) => ({ id: m.id, to: m.headers['to'], subject: m.headers['subject'], text: m.text })));
  }

}
