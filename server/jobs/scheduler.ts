import { getDb, getSettings, getState, setState, pauseInfo, pause, type Settings } from '../db/index.ts';
import { getDraft, getTarget, setDraftState } from '../db/repo.ts';
import { sendDraft } from '../gmail/send.ts';
import { GmailAuthError, apiConnected, isConnected } from '../gmail/oauth.ts';
import { safePoll } from '../gmail/watch.ts';
import { createDueFollowups } from '../pipeline.ts';
import { checkClaude } from '../claude/health.ts';
import { log } from '../log.ts';

// ---------- time helpers ----------
export function localParts(date: Date, timeZone?: string | null) {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: timeZone || undefined, hour: 'numeric', hourCycle: 'h23', weekday: 'short' });
    const parts = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
    return { hour: Number(parts.hour), weekday: parts.weekday as string };
  } catch {
    return localParts(date, null);
  }
}

/** Recipient-local business hours when their timezone is known; your own waking hours otherwise. */
export function inSendWindow(date: Date, tz: string | null, s: Pick<Settings, 'send_window_start' | 'send_window_end'>) {
  const { hour, weekday } = localParts(date, tz);
  if (tz && (weekday === 'Sat' || weekday === 'Sun')) return false;
  return hour >= s.send_window_start && hour < s.send_window_end;
}

export function startOfLocalDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

export function sentToday(): number {
  return (getDb().prepare("SELECT COUNT(*) n FROM messages WHERE channel = 'gmail' AND sent_at >= ?").get(startOfLocalDay().replace('T', ' ').slice(0, 19)) as { n: number }).n;
}

export function randomGapMs(s: Pick<Settings, 'gap_min_minutes' | 'gap_max_minutes'>, rand = Math.random) {
  const min = s.gap_min_minutes * 60_000;
  const max = s.gap_max_minutes * 60_000;
  return Math.round(min + rand() * (max - min));
}

// ---------- queue ----------
export function enqueue(draftId: number) {
  setDraftState(draftId, 'queued');
  getDb().prepare("INSERT OR REPLACE INTO send_queue (draft_id, not_before) VALUES (?, datetime('now'))").run(draftId);
}

export function queueStats() {
  const s = getSettings();
  const queued = (getDb().prepare('SELECT COUNT(*) n FROM send_queue').get() as { n: number }).n;
  return { queued, sentToday: sentToday(), cap: s.daily_cap, nextSendAt: getState('next_send_at') };
}

/** One step of the send loop. Sends at most one email. Exported for tests. */
export async function sendTick(now = new Date()): Promise<'paused' | 'waiting' | 'cap' | 'empty' | 'outside_window' | 'sent' | 'failed'> {
  if (pauseInfo().paused) return 'paused';
  const s = getSettings();
  const next = getState('next_send_at');
  if (next && Date.parse(next) > now.getTime()) return 'waiting';
  if (sentToday() >= s.daily_cap) return 'cap';

  const rows = getDb().prepare('SELECT q.draft_id, q.attempts FROM send_queue q ORDER BY q.enqueued_at ASC, q.draft_id ASC').all() as { draft_id: number; attempts: number }[];
  if (!rows.length) return 'empty';
  const pick = rows.find((r) => {
    const d = getDraft(r.draft_id);
    const t = d?.target_id ? getTarget(d.target_id) : null;
    return inSendWindow(now, d?.kind === 'intro_request' ? null : (t?.timezone ?? null), s);
  });
  if (!pick) return 'outside_window';

  try {
    await sendDraft(pick.draft_id);
    setState('next_send_at', new Date(now.getTime() + randomGapMs(s)).toISOString());
    log.info(`Sent draft ${pick.draft_id}`);
    return 'sent';
  } catch (err) {
    const msg = (err as Error).message;
    log.error(`Send failed for draft ${pick.draft_id}: ${msg}`);
    if (err instanceof GmailAuthError) {
      pause(msg);
      return 'failed';
    }
    const attempts = pick.attempts + 1;
    if (attempts >= 3 || /opted out|form-only|not approved|Follow-up already|already replied|declined|closed/.test(msg)) {
      getDb().prepare('DELETE FROM send_queue WHERE draft_id = ?').run(pick.draft_id);
      setDraftState(pick.draft_id, 'failed');
    } else {
      getDb().prepare("UPDATE send_queue SET attempts = ?, last_error = ?, not_before = datetime('now', '+10 minutes') WHERE draft_id = ?").run(attempts, msg, pick.draft_id);
    }
    return 'failed';
  }
}

// ---------- loop ----------
let timer: NodeJS.Timeout | null = null;
let busy = false;
let lastPoll = 0;
let lastFollowups = 0;
let lastHealth = 0;

async function loop() {
  if (busy) return;
  busy = true;
  try {
    const s = getSettings();
    const now = Date.now();
    if (now - lastHealth > 30 * 60_000) {
      lastHealth = now;
      const h = await checkClaude(true);
      if (!h.ok) pause(`Claude Code: ${h.error ?? 'unavailable'}`);
    }
    if (pauseInfo().paused || !isConnected()) return;
    // Automatic mode only: send the queue and watch the inbox. Gmail web mode hands each email to Gmail instead.
    if (s.send_mode === 'gmail_api' && apiConnected()) {
      await sendTick();
      if (now - lastPoll > s.poll_minutes * 60_000) {
        lastPoll = now;
        await safePoll();
      }
    }
    if (s.followups_enabled && now - lastFollowups > 60 * 60_000) {
      lastFollowups = now;
      await createDueFollowups(s.followup_days).catch((e) => log.error(`Follow-ups: ${(e as Error).message}`));
    }
  } catch (err) {
    log.error(`Scheduler: ${(err as Error).message}`);
  } finally {
    busy = false;
  }
}

export function startScheduler() {
  if (timer) return;
  timer = setInterval(loop, 15_000);
  setTimeout(loop, 2_000);
}
export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
export function forcePollSoon() {
  lastPoll = 0;
}
