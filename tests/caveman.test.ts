import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeApp, onboard, waitFor } from './helpers.ts';
import { saveSettings } from '../server/db/index.ts';

const LOG = path.join(os.tmpdir(), `autoreach-claude-log-${process.pid}.jsonl`);
const calls = () =>
  fs.existsSync(LOG)
    ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { args: string[]; props: string[] })
    : [];
const systemOf = (c: { args: string[] }) => c.args[c.args.indexOf('--system-prompt') + 1];

describe('caveman mode for internal research', () => {
  beforeEach(async () => {
    fs.rmSync(LOG, { force: true });
    process.env.FAKE_CLAUDE_LOG = LOG;
  });

  it('research is compressed, the email draft is not', async () => {
    const ctx = await makeApp();
    await onboard(ctx.call);
    await ctx.call('POST', '/api/targets', { name: 'Caveman Co', contact_email: 'hi@caveman.test' });
    await waitFor(async () => (await ctx.call('GET', '/api/review')).body.length === 1);
    const research = calls().find((c) => c.props.includes('favourites'))!;
    const draft = calls().find((c) => c.props.includes('unique_reference'))!;
    expect(systemOf(research)).toMatch(/caveman/);
    expect(systemOf(draft)).not.toMatch(/caveman/);
  });

  it('can be switched off in settings', async () => {
    const ctx = await makeApp();
    await onboard(ctx.call);
    saveSettings({ compact_research: false });
    await ctx.call('POST', '/api/targets', { name: 'Plain Co', contact_email: 'hi@plain.test' });
    await waitFor(async () => (await ctx.call('GET', '/api/review')).body.length === 1);
    expect(systemOf(calls().find((c) => c.props.includes('favourites'))!)).not.toMatch(/caveman/);
    delete process.env.FAKE_CLAUDE_LOG;
  });
});
