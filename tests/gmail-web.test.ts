import { describe, it, expect, beforeEach } from 'vitest';
import { makeApp, waitFor } from './helpers.ts';
import { fakeGmail } from '../server/gmail/api.ts';
import { saveSettings } from '../server/db/index.ts';
import { sendTick } from '../server/jobs/scheduler.ts';
import { suppressContact } from '../server/compliance.ts';

async function webOnboard(call: Awaited<ReturnType<typeof makeApp>>['call']) {
  await call('PUT', '/api/profile', {
    alias: 'Prabal',
    pitch: 'Heavy 150 BPM dubstep with metallic growls.',
    niches: ['dubstep'],
    links: [],
    best_works: [{ title: 'Track', url: 'https://soundcloud.com/sample/private', note: '' }],
    goals: ['signing'],
  });
  return call('POST', '/api/gmail/web', { email: ' Me.Artist@Gmail.com ' });
}

async function ready(ctx: Awaited<ReturnType<typeof makeApp>>, name: string, email: string) {
  const t = await ctx.call('POST', '/api/targets', { name, contact_email: email });
  await waitFor(async () => (await ctx.call('GET', '/api/review')).body.find((c: any) => c.target?.id === t.body.id));
  return (await ctx.call('GET', '/api/review')).body.find((c: any) => c.target?.id === t.body.id);
}

describe('Gmail web mode (no setup, nothing stored)', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeEach(async () => {
    ctx = await makeApp();
  });

  it('only needs the address; it is the default mode', async () => {
    const h = (await webOnboard(ctx.call)).body;
    expect(h.gmail).toMatchObject({ connected: true, email: 'me.artist@gmail.com', mode: 'gmail_web' });
    const done = await ctx.call('POST', '/api/onboarding/complete');
    expect(done.status).toBe(200);
  });

  it('rejects a non-email', async () => {
    const r = await ctx.call('POST', '/api/gmail/web', { email: 'not an email' });
    expect(r.status).toBe(400);
  });

  it('approve returns a filled-in Gmail compose link and records the send; nothing goes through the API', async () => {
    await webOnboard(ctx.call);
    const card = await ready(ctx, 'Web Label', 'demos@weblabel.test');
    const r = await ctx.call('POST', `/api/drafts/${card.draft.id}/approve`, {});
    expect(r.status).toBe(200);
    const u = new URL(r.body.composeUrl);
    expect(u.origin + u.pathname).toBe('https://mail.google.com/mail/');
    expect(u.searchParams.get('authuser')).toBe('me.artist@gmail.com');
    expect(u.searchParams.get('to')).toBe('demos@weblabel.test');
    expect(u.searchParams.get('su')).toBe(card.draft.subject);
    expect(u.searchParams.get('body')).toContain("If this isn't a fit");
    expect(r.body.draft.state).toBe('sent');
    expect((await ctx.call('GET', `/api/targets/${card.target.id}`)).body.target.status).toBe('sent');
    expect(fakeGmail.sent()).toHaveLength(0);
    expect(await sendTick()).toBe('empty');
  });

  it('still blocks opted-out contacts and respects the daily cap', async () => {
    await webOnboard(ctx.call);
    const a = await ready(ctx, 'Cap One', 'demos@capone.test');
    const b = await ready(ctx, 'Cap Two', 'demos@captwo.test');
    saveSettings({ daily_cap: 1 });
    expect((await ctx.call('POST', `/api/drafts/${a.draft.id}/approve`, {})).status).toBe(200);
    const capped = await ctx.call('POST', `/api/drafts/${b.draft.id}/approve`, {});
    expect(capped.status).toBe(409);
    expect(capped.body.error).toMatch(/Daily limit/);
    saveSettings({ daily_cap: 10 });
    suppressContact('demos@captwo.test', 'test');
    const blocked = await ctx.call('POST', `/api/drafts/${b.draft.id}/approve`, {});
    expect(blocked.status).toBe(409);
    expect((await ctx.call('GET', '/api/review')).body.map((c: any) => c.draft.id)).toContain(b.draft.id);
  });

  it('a pasted reply with an offer raises the alert (no email layer in web mode)', async () => {
    await webOnboard(ctx.call);
    const card = await ready(ctx, 'Offer Label', 'demos@offer.test');
    await ctx.call('POST', `/api/drafts/${card.draft.id}/approve`, {});
    const r = await ctx.call('POST', `/api/targets/${card.target.id}/reply`, { text: 'We can offer a $400 advance and a contract for the single.' });
    expect(r.body.label).toBe('offer');
    const alerts = (await ctx.call('GET', '/api/alerts')).body.pending;
    expect(alerts).toHaveLength(1);
    expect(alerts[0].thread_id).toBe(`manual-${card.target.id}`);
    expect(fakeGmail.sent()).toHaveLength(0);
  });

  it('a pasted opt-out is permanent', async () => {
    await webOnboard(ctx.call);
    const card = await ready(ctx, 'Stop Label', 'demos@stop.test');
    await ctx.call('POST', `/api/drafts/${card.draft.id}/approve`, {});
    const r = await ctx.call('POST', `/api/targets/${card.target.id}/reply`, { text: 'Please do not contact us again.' });
    expect(r.body.label).toBe('opt_out');
    expect((await ctx.call('POST', '/api/targets', { name: 'Stop 2', contact_email: 'x@stop.test' })).status).toBe(409);
  });

  it('replies search covers everyone contacted', async () => {
    await webOnboard(ctx.call);
    const card = await ready(ctx, 'Search Label', 'demos@search.test');
    await ctx.call('POST', `/api/drafts/${card.draft.id}/approve`, {});
    const s = (await ctx.call('GET', '/api/gmail/replies-search')).body;
    expect(decodeURIComponent(s.url)).toContain('from:(demos@search.test)');
    expect(s.url).toContain('authuser=me.artist%40gmail.com');
  });
});
