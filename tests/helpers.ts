import { resetDbForTests } from '../server/db/index.ts';
import { buildApp } from '../server/app.ts';
import { fakeGmail } from '../server/gmail/api.ts';
import { checkClaude, resetHealthForTests } from '../server/claude/health.ts';
import { resetContextJobForTests } from '../server/profileContext.ts';

export const TOKEN = 'a'.repeat(48);
export const HOSTHDR = '127.0.0.1:4799';

export async function makeApp() {
  resetDbForTests();
  fakeGmail.reset();
  process.env.FAKE_CLAUDE_MODE = 'ok';
  delete process.env.FAKE_CLAUDE_CONTEXT_FAIL;
  resetHealthForTests();
  resetContextJobForTests();
  await checkClaude(true);
  const app = await buildApp(TOKEN, { port: 4799, onShutdown: () => {} });
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
    const res = await app.inject({
      method,
      url,
      payload: payload as object,
      headers: { host: HOSTHDR, 'x-autoreach-token': TOKEN, origin: 'http://127.0.0.1:4799' },
    });
    let body: any = null;
    try {
      body = res.json();
    } catch {
      body = res.body;
    }
    return { status: res.statusCode, body };
  };
  return { app, call };
}

export async function waitFor<T>(fn: () => T | Promise<T>, ms = 8000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('waitFor timed out');
}

/** Profile + fake Gmail connection, the state after onboarding. */
export async function onboard(call: Awaited<ReturnType<typeof makeApp>>['call']) {
  await call('PUT', '/api/profile', {
    alias: 'Prabal',
    real_name: 'Prabal',
    pitch: 'Heavy 150 BPM dubstep with metallic growls.',
    niches: ['dubstep', 'riddim'],
    links: [{ label: 'SoundCloud', url: 'https://soundcloud.com/sample' }],
    best_works: [{ title: 'Sample Track', url: 'https://soundcloud.com/sample/private', note: 'unreleased' }],
    goals: ['deal'],
  });
  await call('GET', '/oauth/google/callback?fake=1');
  return call('POST', '/api/onboarding/complete');
}
