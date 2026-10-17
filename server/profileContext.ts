import { getProfile, profileComplete, saveProfile } from './db/repo.ts';
import { buildProfileContext } from './claude/tasks.ts';
import { log } from './log.ts';
import type { ContextJob } from '../shared/types.ts';

const MAX_ACTIVITY = 60;
let job: ContextJob = { status: 'idle', startedAt: null, finishedAt: null, activity: [], error: null };

export const contextJob = (): ContextJob => job;

/** The "ifContext" switch: once Claude has researched the person, the context step is skipped. */
export function hasContext() {
  return getProfile().profile_context !== null;
}

/** Starts the research in the background. Returns false if it cannot start (already running, profile incomplete). */
export function startContextJob(note?: string): { started: boolean; reason?: string } {
  if (job.status === 'running') return { started: false, reason: 'Already running' };
  const p = getProfile();
  if (!profileComplete(p)) return { started: false, reason: 'Finish your profile first.' };
  job = { status: 'running', startedAt: new Date().toISOString(), finishedAt: null, activity: [], error: null };
  buildProfileContext(p, (a) => {
    job.activity.push(a);
    if (job.activity.length > MAX_ACTIVITY) job.activity.shift();
  }, note)
    .then((ctx) => {
      saveProfile({ profile_context: ctx, context_at: new Date().toISOString(), context_skipped_at: null });
      job = { ...job, status: 'done', finishedAt: new Date().toISOString() };
    })
    .catch((err) => {
      log.error(`Profile context: ${(err as Error).message}`);
      job = { ...job, status: 'failed', finishedAt: new Date().toISOString(), error: (err as Error).message };
    });
  return { started: true };
}

export function skipContext() {
  saveProfile({ context_skipped_at: new Date().toISOString() });
}

/** Tests only. */
export function resetContextJobForTests() {
  job = { status: 'idle', startedAt: null, finishedAt: null, activity: [], error: null };
}
