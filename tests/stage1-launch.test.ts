import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { makeApp, TOKEN } from './helpers.ts';
import { checkClaude } from '../server/claude/health.ts';
import { runClaude, childEnv, ClaudeAuthError, cliSchema } from '../server/claude/runner.ts';
import { BriefSchema } from '../server/claude/schemas.ts';
import { pauseInfo } from '../server/db/index.ts';

describe('stage 1: launcher, security, Claude Code health', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeEach(async () => {
    ctx = await makeApp();
  });

  it('ping is public, API needs the session token', async () => {
    const ping = await ctx.app.inject({ url: '/api/ping', headers: { host: '127.0.0.1:4799' } });
    expect(ping.json()).toEqual({ app: 'autoreach', ok: true });
    const denied = await ctx.app.inject({ url: '/api/profile', headers: { host: '127.0.0.1:4799' } });
    expect(denied.statusCode).toBe(401);
    const ok = await ctx.app.inject({ url: '/api/profile', headers: { host: '127.0.0.1:4799', 'x-autoreach-token': TOKEN } });
    expect(ok.statusCode).toBe(200);
  });

  it('rejects foreign Host headers (DNS rebinding) and foreign origins', async () => {
    const r1 = await ctx.app.inject({ url: '/api/ping', headers: { host: 'evil.test:4799' } });
    expect(r1.statusCode).toBe(403);
    const r2 = await ctx.app.inject({ method: 'PUT', url: '/api/settings', payload: { daily_cap: 10 }, headers: { host: '127.0.0.1:4799', 'x-autoreach-token': TOKEN, origin: 'https://evil.test' } });
    expect(r2.statusCode).toBe(403);
  });

  it('launcher URL token sets an httpOnly cookie', async () => {
    const r = await ctx.app.inject({ url: `/?t=${TOKEN}`, headers: { host: '127.0.0.1:4799' } });
    expect(r.statusCode).toBe(302);
    expect(String(r.headers['set-cookie'])).toMatch(/ar_session=.*HttpOnly/i);
  });

  it('child env drops parent session markers and API keys', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.CLAUDECODE = '1';
    process.env.CLAUDE_CODE_SESSION_ID = 'x';
    const env = childEnv();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
  });

  it('JSON schema passed to the CLI has no draft-2020 $schema tag (the CLI rejects it)', () => {
    const j = JSON.parse(cliSchema(BriefSchema));
    expect(j.$schema).toBeUndefined();
    expect(j.type).toBe('object');
  });

  it('health check passes with a logged-in Claude Code', async () => {
    const h = await checkClaude(true);
    expect(h).toMatchObject({ ok: true, installed: true, loggedIn: true });
  });

  it('health check reports not-logged-in, and a task failure pauses everything', async () => {
    process.env.FAKE_CLAUDE_MODE = 'nologin';
    const h = await checkClaude(true);
    expect(h.ok).toBe(false);
    expect(h.error).toMatch(/Not logged in/);
    await expect(runClaude({ task: 't', system: 's', prompt: 'p', schema: z.object({ ok: z.boolean() }), model: 'haiku' })).rejects.toBeInstanceOf(ClaudeAuthError);
    expect(pauseInfo()).toMatchObject({ paused: true });
    const health = await ctx.call('GET', '/api/health');
    expect(health.body.paused.paused).toBe(true);
  });

  it('a successful re-check after logging in lifts a Claude-caused pause', async () => {
    process.env.FAKE_CLAUDE_MODE = 'nologin';
    await expect(runClaude({ task: 't', system: 's', prompt: 'p', schema: z.object({ ok: z.boolean() }), model: 'haiku' })).rejects.toBeTruthy();
    expect(pauseInfo().paused).toBe(true);
    process.env.FAKE_CLAUDE_MODE = 'ok';
    const r = await ctx.call('POST', '/api/health/recheck');
    expect(r.body.claude.ok).toBe(true);
    expect(r.body.paused.paused).toBe(false);
  });

  it('resume refuses while Claude Code is still logged out', async () => {
    process.env.FAKE_CLAUDE_MODE = 'nologin';
    const r = await ctx.call('POST', '/api/system/resume');
    expect(r.status).toBe(409);
    process.env.FAKE_CLAUDE_MODE = 'ok';
    const r2 = await ctx.call('POST', '/api/system/resume');
    expect(r2.status).toBe(200);
    expect(r2.body.paused.paused).toBe(false);
  });
});
