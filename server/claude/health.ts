import { z } from 'zod';
import { setState, nowIso, pauseInfo, unpause } from '../db/index.ts';
import { spawnClaude, ClaudeAuthError, cliSchema, resultLine } from './runner.ts';

export interface ClaudeHealth {
  ok: boolean;
  installed: boolean;
  loggedIn: boolean;
  version: string | null;
  error: string | null;
  checkedAt: string;
}

/** Where the current check is, for the "Connecting to Claude Code" screen. */
export type CheckStage = 'idle' | 'finding' | 'signing_in';

const PingSchema = z.object({ ok: z.boolean() });

// In-memory only: a result from a previous server run must not show before this run's check finishes.
let cache: ClaudeHealth | null = null;
let inflight: Promise<ClaudeHealth> | null = null;
let stage: CheckStage = 'idle';
let foundVersion: string | null = null;
const TTL_MS = 30 * 60 * 1000;

export function cachedClaudeHealth(): ClaudeHealth | null {
  return cache;
}

export function claudeCheckState() {
  return { checking: inflight !== null, stage, version: foundVersion };
}

/** Starts a check in the background if none ran yet. Never blocks. */
export function ensureClaudeChecked() {
  if (!cache && !inflight) void checkClaude();
}

/**
 * Runs `claude --version`, then a one-turn ping. Concurrent callers share one check.
 * liftPause: the person asked for this check (boot or "Check again"), so a pause Claude caused is lifted on success.
 */
export function checkClaude(force = false, opts: { liftPause?: boolean } = {}): Promise<ClaudeHealth> {
  if (!force && cache && Date.now() - Date.parse(cache.checkedAt) < TTL_MS) return Promise.resolve(cache);
  if (inflight) return inflight.then((h) => (opts.liftPause ? lift(h) : h));
  inflight = run()
    .then((h) => (opts.liftPause ? lift(h) : h))
    .finally(() => {
      inflight = null;
      stage = 'idle';
    });
  return inflight;
}

function lift(h: ClaudeHealth) {
  if (h.ok && pauseInfo().reason?.startsWith('Claude Code')) unpause();
  return h;
}

async function run(): Promise<ClaudeHealth> {
  const result: ClaudeHealth = { ok: false, installed: false, loggedIn: false, version: null, error: null, checkedAt: nowIso() };
  try {
    stage = 'finding';
    const v = await spawnClaude(['--version'], '', 20_000);
    if (v.code !== 0) throw new Error(v.stderr || 'claude --version failed');
    result.installed = true;
    result.version = v.stdout.trim().split(/\s+/)[0] ?? null;
    foundVersion = result.version;

    stage = 'signing_in';
    const ping = await spawnClaude(
      [
        '-p', '--output-format', 'json', '--no-session-persistence', '--model', 'haiku', '--max-turns', '1',
        '--tools', '', '--setting-sources', 'project', '--strict-mcp-config',
        '--json-schema', cliSchema(PingSchema),
      ],
      'Health check. Return {"ok": true}.',
      60_000,
    );
    let parsed: { is_error?: boolean; result?: string } = {};
    try {
      parsed = JSON.parse(resultLine(ping.stdout));
    } catch {
      throw new Error((ping.stderr || ping.stdout || 'No output from claude').slice(0, 300));
    }
    if (parsed.is_error) throw new Error(parsed.result || 'Claude Code returned an error');
    result.loggedIn = true;
    result.ok = true;
  } catch (err) {
    result.error = err instanceof ClaudeAuthError ? err.message : (err as Error).message;
  }
  result.checkedAt = nowIso();
  cache = result;
  setState('claude_health', JSON.stringify(result));
  return result;
}

/** Tests only. */
export function resetHealthForTests() {
  cache = null;
  inflight = null;
  stage = 'idle';
  foundVersion = null;
}
