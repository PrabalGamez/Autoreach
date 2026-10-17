import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FAKE_GMAIL, ORIGIN } from '../config.ts';
import { getDb, getSettings, saveSettings, pauseInfo, unpause, getState, setState, DEFAULT_SETTINGS } from '../db/index.ts';
import { getProfile, profileComplete, saveProfile } from '../db/repo.ts';
import { cachedClaudeHealth, checkClaude, claudeCheckState, ensureClaudeChecked } from '../claude/health.ts';
import { contextJob, hasContext, skipContext, startContextJob } from '../artistContext.ts';
import { queueDepth } from '../claude/runner.ts';
import { extractVoice } from '../claude/tasks.ts';
import { buildAuthUrl, disconnect, handleCallback, hasClient, isConnected, saveClient, sendMode } from '../gmail/oauth.ts';
import { searchUrl } from '../gmail/compose.ts';
import { connectFake, gmail } from '../gmail/api.ts';
import { initHistory } from '../gmail/watch.ts';
import { sendToSelf } from '../gmail/send.ts';
import { pendingAlerts } from '../alerts/offers.ts';
import { queueStats, forcePollSoon } from '../jobs/scheduler.ts';
import type { Health } from '../../shared/types.ts';

const Link = z.object({ label: z.string().max(40), url: z.string().url() });
const Work = z.object({ title: z.string().min(1).max(120), url: z.string().url(), note: z.string().max(200).default('') });
const ProfileBody = z.object({
  alias: z.string().min(1).max(80),
  real_name: z.string().max(80).default(''),
  pitch: z.string().min(5).max(200),
  niches: z.array(z.string().max(40)).min(1).max(10),
  links: z.array(Link).max(8),
  best_works: z.array(Work).min(1).max(3),
  goals: z.array(z.enum(['signing', 'sync', 'sponsorship', 'collab', 'paid gig'])).min(1),
  postal_address: z.string().max(300).default(''),
}).partial();

export function healthPayload(): Health {
  const gmailErr = getState('gmail_error');
  const p = getProfile();
  return {
    claude: cachedClaudeHealth(),
    gmail: { connected: isConnected(), email: p.sender_email, hasClient: hasClient(), error: gmailErr, mode: sendMode() },
    paused: pauseInfo(),
    onboarded: Boolean(p.onboarded_at),
    claudeCheck: claudeCheckState(),
    profileComplete: profileComplete(p),
    hasContext: hasContext(),
    contextSkipped: Boolean(p.context_skipped_at),
    contextJob: contextJob(),
    jobs: queueDepth(),
    pendingOffers: pendingAlerts().length,
    queue: queueStats(),
    fakeGmail: FAKE_GMAIL,
  };
}

export async function coreRoutes(app: FastifyInstance) {
  app.get('/api/ping', async () => ({ app: 'autoreach', ok: true }));

  /** Never blocks: the UI shows "Connecting to Claude Code" while claudeCheck.checking is true. */
  app.get('/api/health', async () => {
    ensureClaudeChecked();
    return healthPayload();
  });

  /** "Check again" from the blocking screen. Runs in the background; lifts a Claude-caused pause on success. */
  app.post('/api/health/recheck', async () => {
    void checkClaude(true, { liftPause: true });
    return healthPayload();
  });

  // ---- artist context ----
  app.get('/api/artist-context', async () => {
    const p = getProfile();
    return { hasContext: hasContext(), context: p.artist_context, contextAt: p.context_at, skipped: Boolean(p.context_skipped_at), job: contextJob() };
  });
  app.post('/api/artist-context/build', async (req, reply) => {
    if (!cachedClaudeHealth()?.ok) return reply.code(409).send({ error: 'Claude Code is not connected yet.' });
    const { note } = z.object({ note: z.string().max(400).optional() }).parse(req.body ?? {});
    const r = startContextJob(note || undefined);
    if (!r.started && r.reason !== 'Already running') return reply.code(400).send({ error: r.reason });
    return { job: contextJob() };
  });
  app.post('/api/artist-context/skip', async () => {
    skipContext();
    return healthPayload();
  });

  /** Resume after a pause: re-runs both checks first, never resumes blindly. */
  app.post('/api/system/resume', async (_req, reply) => {
    const h = await checkClaude(true);
    if (!h.ok) return reply.code(409).send({ error: `Claude Code still unavailable: ${h.error}` });
    if (sendMode() === 'gmail_api' && isConnected()) {
      try {
        await gmail().profile();
        setState('gmail_error', null);
      } catch (err) {
        return reply.code(409).send({ error: `Gmail still failing: ${(err as Error).message}` });
      }
    }
    unpause();
    return healthPayload();
  });

  // ---- profile & voice ----
  app.get('/api/profile', async () => getProfile());
  app.put('/api/profile', async (req) => saveProfile(ProfileBody.parse(req.body)));

  app.post('/api/profile/voice', async (req) => {
    const { samples } = z.object({ samples: z.array(z.string().min(40).max(6000)).min(1).max(3) }).parse(req.body);
    const voice = await extractVoice(samples);
    return saveProfile({ voice_samples: samples, voice_profile: voice });
  });
  app.put('/api/profile/voice', async (req) => {
    const v = z.object({ tone: z.string(), typical_length: z.string(), greeting: z.string(), signoff: z.string(), traits: z.array(z.string()), avoid: z.array(z.string()) }).parse(req.body);
    return saveProfile({ voice_profile: v });
  });

  app.post('/api/onboarding/complete', async (_req, reply) => {
    const p = getProfile();
    if (!p.alias || !p.pitch || !p.best_works.length) return reply.code(400).send({ error: 'Finish your profile first.' });
    if (!isConnected()) return reply.code(400).send({ error: 'Connect Gmail first.' });
    return saveProfile({ onboarded_at: new Date().toISOString() });
  });

  // ---- settings ----
  app.get('/api/settings', async () => getSettings());
  app.put('/api/settings', async (req) => {
    const partial = z
      .object({
        daily_cap: z.number().int().min(1).max(50),
        gap_min_minutes: z.number().min(1).max(60),
        gap_max_minutes: z.number().min(1).max(120),
        followups_enabled: z.boolean(),
        followup_days: z.number().int().min(2).max(60),
        poll_minutes: z.number().int().min(2).max(120),
        send_window_start: z.number().int().min(0).max(23),
        send_window_end: z.number().int().min(1).max(24),
        model_drafting: z.string(),
        model_research: z.string(),
        model_classify: z.string(),
        alert_email: z.boolean(),
        send_mode: z.enum(['gmail_web', 'gmail_api']),
        alert_desktop: z.boolean(),
        offer_confidence: z.number().min(0.3).max(0.95),
      })
      .partial()
      .parse(req.body) as Partial<typeof DEFAULT_SETTINGS>;
    return saveSettings(partial);
  });

  // ---- gmail ----
  /** Gmail web mode: just the address. No passwords or tokens; approved emails open in Gmail's compose window. */
  app.post('/api/gmail/web', async (req) => {
    const { email } = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email address') }).parse(req.body);
    saveProfile({ sender_email: email });
    saveSettings({ send_mode: 'gmail_web' });
    setState('gmail_error', null);
    return healthPayload();
  });

  /** One Gmail search for replies from everyone you have contacted. */
  app.get('/api/gmail/replies-search', async (_req, reply) => {
    const p = getProfile();
    if (!p.sender_email) return reply.code(400).send({ error: 'Add your Gmail address first.' });
    const rows = getDb().prepare("SELECT DISTINCT to_email FROM messages WHERE channel = 'gmail' AND to_email IS NOT NULL ORDER BY id DESC LIMIT 60").all() as { to_email: string }[];
    return { url: searchUrl(p.sender_email, rows.map((r) => r.to_email)), count: rows.length };
  });

  app.post('/api/gmail/client', async (req) => {
    const b = z.object({ clientId: z.string().regex(/\.apps\.googleusercontent\.com$/, 'Client ID should end with .apps.googleusercontent.com'), clientSecret: z.string().min(10) }).parse(req.body);
    saveClient(b.clientId, b.clientSecret);
    return { ok: true };
  });

  app.get('/api/gmail/auth-url', async (_req, reply) => {
    if (FAKE_GMAIL) return { url: `${ORIGIN}/oauth/google/callback?fake=1` };
    try {
      return { url: buildAuthUrl() };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get('/oauth/google/callback', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const page = (title: string, msg: string) =>
      reply.type('text/html').send(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;background:#EBE8E3;color:#141A16;display:grid;place-items:center;height:100vh;margin:0"><div style="max-width:420px"><h1 style="font-weight:400;letter-spacing:-0.03em">${title}</h1><p>${msg}</p><p><a href="/" style="color:#2F5640">Back to Autoreach</a></p></div><script>setTimeout(()=>location.href='/',2500)</script>`);
    try {
      if (FAKE_GMAIL && q.fake) connectFake(getState('fake_gmail_email') ?? 'you@example.test');
      else {
        if (q.error) throw new Error(q.error === 'access_denied' ? 'You declined access.' : q.error);
        await handleCallback(q.code, q.state);
      }
      const p = await initHistory();
      saveProfile({ sender_email: p.emailAddress.toLowerCase() });
      saveSettings({ send_mode: 'gmail_api' });
      return page('Gmail connected', `Autoreach will send as ${p.emailAddress}.`);
    } catch (err) {
      return page('Gmail not connected', (err as Error).message.replace(/</g, '&lt;'));
    }
  });

  app.post('/api/gmail/test', async (_req, reply) => {
    if (sendMode() !== 'gmail_api') return reply.code(400).send({ error: 'Automatic mode only.' });
    const r = await sendToSelf('Autoreach test', 'Gmail is connected. Autoreach can send from this address.\n\nYou can delete this email.');
    return { ok: true, id: r.id };
  });

  app.post('/api/gmail/disconnect', async () => {
    disconnect();
    saveSettings({ send_mode: 'gmail_web' });
    return healthPayload();
  });

  app.post('/api/gmail/poll', async () => {
    forcePollSoon();
    return { ok: true };
  });

  app.get('/api/jobs', async () => getDb().prepare('SELECT * FROM ai_jobs ORDER BY id DESC LIMIT 40').all());
}
