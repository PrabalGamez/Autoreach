import { describe, it, expect, beforeEach } from 'vitest';
import { makeApp, onboard, waitFor } from './helpers.ts';
import { getDb, setState, saveSettings } from '../server/db/index.ts';
import { sendTick, inSendWindow, randomGapMs } from '../server/jobs/scheduler.ts';
import { fakeGmail } from '../server/gmail/api.ts';
import { buildMime } from '../server/gmail/send.ts';
import { canSend } from '../server/compliance.ts';

async function readyTarget(ctx: Awaited<ReturnType<typeof makeApp>>, name: string, email: string) {
  const t = await ctx.call('POST', '/api/targets', { name, contact_email: email });
  await waitFor(async () => (await ctx.call('GET', `/api/targets/${t.body.id}`)).body.target.status === 'draft_ready');
  // Tests run at any hour: clear timezone and open the window fully.
  await ctx.call('PATCH', `/api/targets/${t.body.id}`, { timezone: null });
  const card = (await ctx.call('GET', '/api/review')).body.find((c: any) => c.target?.id === t.body.id);
  return { target: t.body, draft: card.draft };
}

describe('stage 5: flashcard review', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeEach(async () => {
    ctx = await makeApp();
    await onboard(ctx.call);
  });

  it('edit, skip, regenerate, discard', async () => {
    const { draft } = await readyTarget(ctx, 'Edit Label', 'demos@edit.test');
    const e = await ctx.call('PATCH', `/api/drafts/${draft.id}`, { subject: 'New subject here', body: draft.body + '\nP.S. edited' });
    expect(e.body.subject).toBe('New subject here');
    const s = await ctx.call('POST', `/api/drafts/${draft.id}/skip`);
    expect(s.body.state).toBe('skipped');
    const r = await ctx.call('POST', `/api/drafts/${draft.id}/regenerate`, { note: 'shorter' });
    expect(r.body.version).toBe(2);
    expect(r.body.regen_note).toBe('shorter');
    const cards = (await ctx.call('GET', '/api/review')).body;
    expect(cards.map((c: any) => c.draft.id)).toEqual([r.body.id]);
    const d = await ctx.call('POST', `/api/drafts/${r.body.id}/discard`);
    expect(d.body.state).toBe('discarded');
  });

  it('there is no bulk approve endpoint', async () => {
    const r = await ctx.call('POST', '/api/drafts/approve-all');
    expect(r.status).toBe(404);
  });

  it('approving a form-only target records it without emailing', async () => {
    const t = await ctx.call('POST', '/api/targets', { name: 'Formy', route: 'form_only', form_url: 'https://www.labelradar.com/labels/formy' });
    await waitFor(async () => (await ctx.call('GET', '/api/review')).body.length === 1);
    const card = (await ctx.call('GET', '/api/review')).body[0];
    expect(card.to).toBeNull();
    const a = await ctx.call('POST', `/api/drafts/${card.draft.id}/approve`, {});
    expect(a.body.draft.state).toBe('submitted_form');
    expect(a.body.formUrl).toMatch(/labelradar/);
    expect(fakeGmail.sent()).toHaveLength(0);
    void t;
  });
});

describe('stage 6: throttled sending', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeEach(async () => {
    ctx = await makeApp();
    await onboard(ctx.call);
    saveSettings({ send_window_start: 0, send_window_end: 24 });
  });

  it('nothing sends without approval', async () => {
    const { draft } = await readyTarget(ctx, 'NoApprove', 'demos@noapprove.test');
    expect(canSend(draft.id).ok).toBe(false);
    expect(await sendTick()).toBe('empty');
    expect(fakeGmail.sent()).toHaveLength(0);
  });

  it('sends one approved email, then waits a randomized 2-6 min gap', async () => {
    const a = await readyTarget(ctx, 'One Label', 'demos@one.test');
    const b = await readyTarget(ctx, 'Two Label', 'demos@two.test');
    await ctx.call('POST', `/api/drafts/${a.draft.id}/approve`, {});
    await ctx.call('POST', `/api/drafts/${b.draft.id}/approve`, {});
    expect(await sendTick()).toBe('sent');
    expect(await sendTick()).toBe('waiting');
    expect(fakeGmail.sent()).toHaveLength(1);
    const sent = fakeGmail.sent()[0];
    expect(sent.headers['to']).toBe('demos@one.test');
    expect(sent.headers['list-unsubscribe']).toMatch(/mailto:you@example.test/);
    expect(sent.text).toContain("If this isn't a fit");
    const t = (await ctx.call('GET', `/api/targets/${a.target.id}`)).body.target;
    expect(t.status).toBe('sent');
    const gap = randomGapMs({ gap_min_minutes: 2, gap_max_minutes: 6 }, () => 0.5);
    expect(gap).toBe(4 * 60_000);
    setState('next_send_at', null);
    expect(await sendTick()).toBe('sent');
  });

  it('respects the daily cap', async () => {
    saveSettings({ daily_cap: 1 });
    const a = await readyTarget(ctx, 'Cap A', 'demos@capa.test');
    const b = await readyTarget(ctx, 'Cap B', 'demos@capb.test');
    await ctx.call('POST', `/api/drafts/${a.draft.id}/approve`, {});
    await ctx.call('POST', `/api/drafts/${b.draft.id}/approve`, {});
    expect(await sendTick()).toBe('sent');
    setState('next_send_at', null);
    expect(await sendTick()).toBe('cap');
  });

  it('send window follows the recipient timezone and skips their weekend', () => {
    const s = { send_window_start: 9, send_window_end: 18 };
    const friNoonLA = new Date('2026-10-16T19:00:00Z');
    expect(inSendWindow(friNoonLA, 'America/Los_Angeles', s)).toBe(true);
    expect(inSendWindow(friNoonLA, 'Asia/Tokyo', s)).toBe(false); // Sat 04:00 in Tokyo
  });

  it('paused system sends nothing', async () => {
    const a = await readyTarget(ctx, 'Paused', 'demos@paused.test');
    await ctx.call('POST', `/api/drafts/${a.draft.id}/approve`, {});
    setState('paused', '1');
    expect(await sendTick()).toBe('paused');
  });

  it('MIME encodes non-ASCII subjects and threads replies', () => {
    const raw = Buffer.from(buildMime({ fromName: 'Prábal', fromEmail: 'a@b.test', to: 'c@d.test', subject: 'Démo', body: 'hi', inReplyTo: '<x@y>' }), 'base64url').toString();
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(raw).toMatch(/In-Reply-To: <x@y>/);
  });
});

describe('stage 7-8: replies, classification, offer alerts', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let target: any;
  beforeEach(async () => {
    ctx = await makeApp();
    await onboard(ctx.call);
    saveSettings({ send_window_start: 0, send_window_end: 24 });
    const r = await readyTarget(ctx, 'Reply Label', 'demos@reply.test');
    target = r.target;
    await ctx.call('POST', `/api/drafts/${r.draft.id}/approve`, {});
    await sendTick();
  });

  it('an offer reply raises an alert, emails you, and blocks until acknowledged', async () => {
    const p = await ctx.call('POST', '/api/dev/fake-reply', { targetId: target.id, text: 'We love it. We can offer a $500 advance and a 50/50 royalty split, contract attached.' });
    expect(p.body.newReplies).toBe(1);
    const t = (await ctx.call('GET', `/api/targets/${target.id}`)).body.target;
    expect(t.status).toBe('offer');
    const alerts = (await ctx.call('GET', '/api/alerts')).body;
    expect(alerts.pending).toHaveLength(1);
    expect(alerts.pending[0].terms.money).toMatch(/\$500/);
    expect(alerts.notice).toMatch(/not legal advice/i);
    const selfMail = fakeGmail.sent().find((m) => m.headers['to'] === 'you@example.test');
    expect(selfMail?.headers['subject']).toMatch(/=\?UTF-8\?B\?/); // 🔥 subject is encoded
    expect(Buffer.from(selfMail!.headers['subject'].slice(10, -2), 'base64').toString()).toBe('🔥 Autoreach: offer from Reply Label');
    const health = (await ctx.call('GET', '/api/health')).body;
    expect(health.pendingOffers).toBe(1);
    const status = (await ctx.call('GET', '/api/status')).body;
    expect(status.offers[0].name).toBe('Reply Label');
    await ctx.call('POST', `/api/alerts/${alerts.pending[0].id}/ack`);
    expect((await ctx.call('GET', '/api/alerts')).body.pending).toHaveLength(0);
  });

  it('draft reply to an offer goes to review, never auto-sends', async () => {
    await ctx.call('POST', '/api/dev/fake-reply', { targetId: target.id, text: 'Offer: $300 advance, contract to follow.' });
    const a = (await ctx.call('GET', '/api/alerts')).body.pending[0];
    const d = await ctx.call('POST', `/api/alerts/${a.id}/draft-reply`);
    expect(d.body.kind).toBe('reply');
    expect(d.body.state).toBe('pending');
  });

  it('a decline marks the target declined', async () => {
    await ctx.call('POST', '/api/dev/fake-reply', { targetId: target.id, text: 'Thanks, but this is not a fit for us right now.' });
    expect((await ctx.call('GET', `/api/targets/${target.id}`)).body.target.status).toBe('declined');
  });

  it('an opt-out is permanent: suppression, no follow-ups, no future contact', async () => {
    await ctx.call('POST', '/api/dev/fake-reply', { targetId: target.id, text: 'Please remove me from your list and do not contact us again.' });
    const sup = getDb().prepare('SELECT value FROM suppression').all() as { value: string }[];
    expect(sup.map((s) => s.value)).toEqual(expect.arrayContaining(['demos@reply.test', 'reply.test']));
    const again = await ctx.call('POST', '/api/targets', { name: 'Reply Label 2', contact_email: 'other@reply.test' });
    expect(again.status).toBe(409);
    // Data delete keeps the suppression list.
    await ctx.call('POST', '/api/data/delete', { confirm: 'DELETE' });
    expect((getDb().prepare('SELECT COUNT(*) n FROM suppression').get() as { n: number }).n).toBeGreaterThan(0);
  });

  it('auto-replies do not count as replies for the dashboard', async () => {
    await ctx.call('POST', '/api/dev/fake-reply', { targetId: target.id, text: 'I am out of office until Monday.' });
    const dash = (await ctx.call('GET', '/api/dashboard')).body;
    expect(dash.sent).toBe(1);
    expect(dash.replied).toBe(0);
  });
});

describe('stage 9: referrals', () => {
  it('suggests intros and drafts a low-pressure intro request for review', async () => {
    const ctx = await makeApp();
    await onboard(ctx.call);
    const p = await ctx.call('POST', '/api/people', { name: 'Rhea', email: 'rhea@example.test', relationship: 'played a show together', notes: 'knows the A&R at Ironworks' });
    await readyTarget(ctx, 'Ironworks', 'demos@ironworks.test');
    await ctx.call('POST', '/api/referrals/suggest');
    const intro = await waitFor(async () => (await ctx.call('GET', '/api/review')).body.find((c: any) => c.draft.kind === 'intro_request'));
    expect(intro.to).toBe('rhea@example.test');
    expect(intro.person.id).toBe(p.body.id);
    const refs = (await ctx.call('GET', '/api/referrals')).body;
    expect(refs[0]).toMatchObject({ person_name: 'Rhea', target_name: 'Ironworks', stage: 'suggested' });
    const upd = await ctx.call('PATCH', `/api/referrals/${refs[0].id}`, { stage: 'intro_made' });
    expect(upd.body.stage).toBe('intro_made');
    const t = (await ctx.call('GET', `/api/targets/${refs[0].target_id}`)).body.target;
    expect(t.referrer_name).toBe('Rhea');
  });
});
