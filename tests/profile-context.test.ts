import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync as Database } from 'node:sqlite';
import { makeApp, onboard, waitFor } from './helpers.ts';
import { migrate } from '../server/db/index.ts';
import { parseActivity, resultLine } from '../server/claude/runner.ts';

describe('profile context (the "ifContext" step)', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeEach(async () => {
    ctx = await makeApp();
  });

  it('refuses to start before the profile is complete', async () => {
    const r = await ctx.call('POST', '/api/context/build');
    expect(r.status).toBe(400);
    expect((await ctx.call('GET', '/api/health')).body.hasContext).toBe(false);
  });

  it('streams live activity, saves the context, and flips hasContext', async () => {
    await onboard(ctx.call);
    const h0 = (await ctx.call('GET', '/api/health')).body;
    expect(h0).toMatchObject({ profileComplete: true, hasContext: false });
    const r = await ctx.call('POST', '/api/context/build');
    expect(r.body.job.status).toBe('running');
    const done = await waitFor(async () => {
      const a = (await ctx.call('GET', '/api/context')).body;
      return a.job.status === 'done' ? a : null;
    });
    expect(done.hasContext).toBe(true);
    expect(done.context.audience_stage).toBe('emerging');
    expect(done.job.activity.map((x: any) => x.kind)).toEqual(['search', 'fetch', 'search', 'fetch', 'search']);
    expect(done.job.activity[0].text).toBe('"Prabal" dubstep producer');
    expect((await ctx.call('GET', '/api/health')).body.hasContext).toBe(true);
  });

  it('a second build while one runs does not start another', async () => {
    await onboard(ctx.call);
    await ctx.call('POST', '/api/context/build');
    const again = await ctx.call('POST', '/api/context/build');
    expect(again.status).toBe(200);
    expect(again.body.job.status).toBe('running');
  });

  it('a failed run is reported and leaves hasContext false', async () => {
    await onboard(ctx.call);
    process.env.FAKE_CLAUDE_CONTEXT_FAIL = '1';
    await ctx.call('POST', '/api/context/build');
    const job = await waitFor(async () => {
      const j = (await ctx.call('GET', '/api/context')).body.job;
      return j.status === 'failed' ? j : null;
    });
    expect(job.error).toBeTruthy();
    expect((await ctx.call('GET', '/api/health')).body.hasContext).toBe(false);
  });

  it('skip is remembered', async () => {
    await onboard(ctx.call);
    const r = await ctx.call('POST', '/api/context/skip');
    expect(r.body.contextSkipped).toBe(true);
    expect(r.body.hasContext).toBe(false);
  });

  it('later drafts include the researched context', async () => {
    await onboard(ctx.call);
    await ctx.call('POST', '/api/context/build');
    await waitFor(async () => (await ctx.call('GET', '/api/context')).body.hasContext);
    const { getProfile } = await import('../server/db/repo.ts');
    expect(getProfile().profile_context?.facts_to_use).toContain('Produces heavy dubstep at 150 BPM');
  });

  it('stream-json parsing: tool uses become activity, the result line is found', () => {
    const a = parseActivity(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query: 'x' } }] } }));
    expect(a[0]).toMatchObject({ kind: 'search', text: 'x' });
    expect(parseActivity('not json')).toEqual([]);
    const out = ['{"type":"system"}', '{"type":"assistant","message":{}}', '{"type":"result","is_error":false}', ''].join('\n');
    expect(JSON.parse(resultLine(out)).type).toBe('result');
  });

  it('migration adds the new columns to an old database', () => {
    const d = new Database(':memory:');
    d.exec('CREATE TABLE profile (id INTEGER PRIMARY KEY, alias TEXT)');
    migrate(d);
    const cols = (d.prepare('PRAGMA table_info(profile)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['profile_context', 'context_at', 'context_skipped_at']));
  });

  it('migration from the music-only v0.1: artist_context renamed, label/collaborator kinds mapped, data kept', () => {
    const d = new Database(':memory:');
    d.exec(`CREATE TABLE profile (id INTEGER PRIMARY KEY, alias TEXT, artist_context TEXT);
      INSERT INTO profile VALUES (1, 'X', '{"summary":"s"}');
      CREATE TABLE targets (id INTEGER PRIMARY KEY, name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'label' CHECK (kind IN ('label','brand','collaborator','other')),
        domain TEXT, contact_email TEXT, contact_source_url TEXT, route TEXT NOT NULL DEFAULT 'email', form_url TEXT, timezone TEXT,
        referred_by INTEGER, origin TEXT NOT NULL DEFAULT 'manual', why_fit TEXT NOT NULL DEFAULT '', proposal_sources TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'researching', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO targets (id, name, kind) VALUES (1, 'A', 'label'), (2, 'B', 'collaborator'), (3, 'C', 'brand');`);
    migrate(d);
    expect((d.prepare('SELECT profile_context FROM profile').get() as { profile_context: string }).profile_context).toBe('{"summary":"s"}');
    expect((d.prepare('SELECT kind FROM targets ORDER BY id').all() as { kind: string }[]).map((r) => r.kind)).toEqual(['company', 'person', 'brand']);
    expect(() => d.exec("INSERT INTO targets (name, kind) VALUES ('D', 'label')")).toThrow();
  });

  it('old goals and old context field names are read in the new shape', async () => {
    const { normalizeGoals, normalizeContext } = await import('../server/db/repo.ts');
    expect(normalizeGoals(['signing', 'sync', 'collab', 'paid gig', 'sponsorship', 'bogus'])).toEqual(['deal', 'licensing', 'collaboration', 'paid work', 'sponsorship']);
    const c = normalizeContext({ sound: 'heavy', releases: [1], similar_artists: ['a'], label_fit: [2] })!;
    expect(c).toMatchObject({ style: 'heavy', work: [1], peers: ['a'], fit: [2] });
    expect((c as unknown as Record<string, unknown>).sound).toBeUndefined();
  });
});
