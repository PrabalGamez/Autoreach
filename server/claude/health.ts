import { z } from 'zod';
import { getState, setState, nowIso } from '../db/index.ts';
import { spawnClaude, ClaudeAuthError, cliSchema } from './runner.ts';

export interface ClaudeHealth {
  ok: boolean;
  installed: boolean;
  loggedIn: boolean;
  version: string | null;
  error: string | null;
  checkedAt: string;
}

const PingSchema = z.object({ ok: z.boolean() });

let cache: ClaudeHealth | null = null;
const TTL_MS = 30 * 60 * 1000;

export function cachedClaudeHealth(): ClaudeHealth | null {
  if (cache) return cache;
  const raw = getState('claude_health');
  return raw ? (JSON.parse(raw) as ClaudeHealth) : null;
}

export async function checkClaude(force = false): Promise<ClaudeHealth> {
  if (!force && cache && Date.now() - Date.parse(cache.checkedAt) < TTL_MS) return cache;
  const result: ClaudeHealth = { ok: false, installed: false, loggedIn: false, version: null, error: null, checkedAt: nowIso() };
  try {
    const v = await spawnClaude(['--version'], '', 20_000);
    if (v.code !== 0) throw new Error(v.stderr || 'claude --version failed');
    result.installed = true;
    result.version = v.stdout.trim().split(/\s+/)[0] ?? null;

    const ping = await spawnClaude(
      [
        '-p', '--output-format', 'json', '--no-session-persistence', '--model', 'haiku', '--max-turns', '1',
        '--tools', '', '--setting-sources', 'project', '--strict-mcp-config',
        '--json-schema', cliSchema(PingSchema),
      ],
      'Health check. Return {"ok": true}.',
      60_000,
    );
    const line = ping.stdout.trim().split('\n').filter(Boolean).pop() ?? '';
    let parsed: { is_error?: boolean; result?: string } = {};
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error((ping.stderr || ping.stdout || 'No output from claude').slice(0, 300));
    }
    if (parsed.is_error) throw new Error(parsed.result || 'Claude Code returned an error');
    result.loggedIn = true;
    result.ok = true;
  } catch (err) {
    result.error = err instanceof ClaudeAuthError ? err.message : (err as Error).message;
  }
  cache = result;
  setState('claude_health', JSON.stringify(result));
  return result;
}
