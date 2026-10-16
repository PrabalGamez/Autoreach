import { describe, it, expect, beforeEach } from 'vitest';
import { makeApp, onboard, waitFor } from './helpers.ts';
import { parseCsv } from '../server/routes/targets.ts';
import { OPT_OUT_LINE } from '../server/claude/tasks.ts';
import { wordCount, similarity } from '../server/quality.ts';
import { suppressContact } from '../server/compliance.ts';

describe('stage 2: onboarding + Gmail', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeEach(async () => (ctx = await makeApp()));

  it('blocks completion until profile and Gmail are set', async () => {
    const r = await ctx.call('POST', '/api/onboarding/complete');
    expect(r.status).toBe(400);
    const done = await onboard(ctx.call);
    expect(done.status).toBe(200);
    expect(done.body.onboarded_at).toBeTruthy();
    expect(done.body.sender_email).toBe('you@example.test');
  });

  it('validates profile input', async () => {
    const r = await ctx.call('PUT', '/api/profile', { best_works: [{ title: 'x', url: 'not a url' }] });
    expect(r.status).toBe(400);
  });

  it('extracts a voice profile from samples', async () => {
    const r = await ctx.call('POST', '/api/profile/voice', { samples: ['Hey Sam, thanks for the quick reply last week. I tightened the drop like you said and it hits way harder now. Cheers, P'] });
    expect(r.status).toBe(200);
    expect(r.body.voice_profile.signoff).toBeTruthy();
  });

  it('clamps the daily cap to the hard maximum of 50', async () => {
    const r = await ctx.call('PUT', '/api/settings', { daily_cap: 80 });
    expect(r.status).toBe(400);
    const ok = await ctx.call('PUT', '/api/settings', { daily_cap: 50 });
    expect(ok.body.daily_cap).toBe(50);
  });

  it('Gmail client ID must look like a Google OAuth client', async () => {
    const r = await ctx.call('POST', '/api/gmail/client', { clientId: 'abc', clientSecret: 'x'.repeat(20) });
    expect(r.status).toBe(400);
  });
});

describe('stage 3: targets', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeEach(async () => {
    ctx = await makeApp();
    await onboard(ctx.call);
  });

  it('CSV parser handles quotes and commas', () => {
    expect(parseCsv('name,contact,notes\n"Label, Inc",demos@x.test,"said ""hi"""')).toEqual([
      ['name', 'contact', 'notes'],
      ['Label, Inc', 'demos@x.test', 'said "hi"'],
    ]);
  });

  it('imports CSV, dedupes by domain and email, marks non-email as form-only', async () => {
    const r = await ctx.call('POST', '/api/targets/import', {
      text: 'name,contact,notes\nAlpha Records,demos@alpha.test,\nAlpha Dupe,info@alpha.test,\nBeta,https://beta.test/submit,form\nGamma,demos@gamma.test,',
    });
    expect(r.body.added.map((t: any) => t.name)).toEqual(['Alpha Records', 'Beta', 'Gamma']);
    expect(r.body.duplicates).toEqual(['Alpha Dupe']);
    expect(r.body.added[1].route).toBe('form_only');
  });

  it('skips opted-out contacts on import and manual add', async () => {
    suppressContact('demos@gone.test', 'test');
    const r = await ctx.call('POST', '/api/targets/import', { text: 'Gone,demos@gone.test,' });
    expect(r.body.skipped).toHaveLength(1);
    const m = await ctx.call('POST', '/api/targets', { name: 'Gone again', contact_email: 'other@gone.test' });
    expect(m.status).toBe(409);
  });

  it('Ask Autoreach proposes targets for one-by-one approval', async () => {
    await ctx.call('POST', '/api/targets/propose', { query: 'heavy dubstep labels that take demos' });
    const proposed = await waitFor(async () => {
      const r = await ctx.call('GET', '/api/targets?status=proposed');
      return r.body.length === 2 ? r.body : null;
    });
    const formOnly = proposed.find((t: any) => t.route === 'form_only');
    expect(formOnly.contact_email).toBeNull();
    expect(formOnly.form_url).toMatch(/labelradar/);
    const rej = await ctx.call('POST', `/api/targets/${formOnly.id}/reject`);
    expect(rej.body.status).toBe('rejected');
  });
});

describe('stage 4: research + drafting', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeEach(async () => {
    ctx = await makeApp();
    await onboard(ctx.call);
  });

  it('researches, saves a brief and creates a compliant draft', async () => {
    const t = await ctx.call('POST', '/api/targets', { name: 'Ironworks Audio', contact_email: 'demos@ironworks.test', domain: 'ironworks.test' });
    expect(t.status).toBe(200);
    await waitFor(async () => (await ctx.call('GET', `/api/targets/${t.body.id}`)).body.target.status === 'draft_ready');
    const { body } = await ctx.call('GET', `/api/targets/${t.body.id}`);
    expect(body.brief.favourites.length).toBeGreaterThanOrEqual(1);
    expect(body.brief.possible_deals[0].type).toBe('single release');
    expect(body.target.timezone).toBe('America/Los_Angeles');

    const cards = (await ctx.call('GET', '/api/review')).body;
    expect(cards).toHaveLength(1);
    const d = cards[0].draft;
    expect(d.body).toContain(OPT_OUT_LINE);
    expect(d.body.toLowerCase()).toContain(d.unique_reference.toLowerCase());
    expect(wordCount(d.body)).toBeLessThan(150);
    expect(cards[0].to).toBe('demos@ironworks.test');
  });

  it('warm targets open with the referral', async () => {
    const p = await ctx.call('POST', '/api/people', { name: 'Sam', email: 'sam@example.test', relationship: 'friend' });
    const t = await ctx.call('POST', '/api/targets', { name: 'Warm Label', contact_email: 'a@warm.test', referred_by: p.body.id });
    await waitFor(async () => (await ctx.call('GET', '/api/review')).body.length === 1);
    const card = (await ctx.call('GET', '/api/review')).body[0];
    expect(card.draft.body.startsWith('Sam suggested I reach out')).toBe(true);
    expect(card.target.referrer_name).toBe('Sam');
    void t;
  });

  it('similarity check catches templated drafts', () => {
    const a = 'Hey team I love your label and think my track fits your sound would you listen';
    expect(similarity(a, a)).toBe(1);
    expect(similarity(a, 'Completely different words about a sync licence for a sneaker campaign')).toBeLessThan(0.1);
  });
});
