#!/usr/bin/env node
// Launcher for the /autoreach slash command: start (default) | status | stop
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = process.env.AUTOREACH_HOME ?? path.join(os.homedir(), '.autoreach');
const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.AUTOREACH_PORT ?? 4747);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN_PATH = path.join(HOME, 'session');
const PID_PATH = path.join(HOME, 'server.pid');
const cmd = (process.argv[2] ?? 'open').toLowerCase();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = () => (fs.existsSync(TOKEN_PATH) ? fs.readFileSync(TOKEN_PATH, 'utf8').trim() : '');

/** Which server answers on the port: 'autoreach', 'autoreach-setup' (first-run install page) or null. */
async function who() {
  try {
    const r = await fetch(`${BASE}/api/ping`, { signal: AbortSignal.timeout(1500) });
    return (await r.json()).app ?? null;
  } catch {
    return null;
  }
}
const ping = async () => (await who()) === 'autoreach';

async function api(p, init = {}) {
  const r = await fetch(`${BASE}${p}`, { ...init, headers: { 'x-autoreach-token': token(), 'content-type': 'application/json', ...(init.headers ?? {}) } });
  return r.json();
}

function claudeInstalled() {
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * Hand off to bin/boot.mjs (detached) and return as soon as something answers on the port, so the
 * browser opens right away. On a first run that is the setup page, which reloads into the app.
 */
async function start() {
  const running = await who();
  if (running) return running;
  fs.mkdirSync(path.join(HOME, 'logs'), { recursive: true });
  const t = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_PATH, t, { mode: 0o600 });
  const child = spawn(process.execPath, [path.join(SELF_ROOT, 'bin', 'boot.mjs')], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, AUTOREACH_HOME: HOME, AUTOREACH_PORT: String(PORT), AUTOREACH_TOKEN: t },
  });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    const w = await who();
    if (w) return w;
  }
  return null;
}

function openBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(opener, [url], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref();
}

async function main() {
  if (cmd === 'stop') {
    if (!(await ping())) return console.log('Autoreach is not running.');
    await api('/api/shutdown', { method: 'POST', headers: { origin: BASE } }).catch(() => {});
    await sleep(400);
    if (await ping() && fs.existsSync(PID_PATH)) process.kill(Number(fs.readFileSync(PID_PATH, 'utf8')), 'SIGTERM');
    return console.log('Autoreach stopped. Queued emails wait until you open it again.');
  }

  if (cmd === 'status') {
    if (!(await ping())) {
      console.log('Autoreach is not running. Queued emails and reply checks are paused. Run /autoreach to start it.');
      return;
    }
    const s = await api('/api/status');
    const h = s.health;
    const lines = [];
    lines.push(`Autoreach — ${BASE}`);
    lines.push(`Claude Code: ${h.claude?.ok ? `ok (${h.claude.version})` : `NOT READY — ${h.claude?.error ?? 'unchecked'}`}`);
    lines.push(`Gmail: ${h.gmail.connected ? `connected as ${h.gmail.email}` : 'not connected'}`);
    if (h.paused.paused) lines.push(`PAUSED: ${h.paused.reason}`);
    lines.push(`Pipeline: ${s.counts.map((c) => `${c.status} ${c.n}`).join(' · ') || 'empty'}`);
    lines.push(`To review: ${s.toReview} · Queued: ${h.queue.queued} · Sent today: ${h.queue.sentToday}/${h.queue.cap}`);
    lines.push(`Last reply check: ${s.lastPoll ?? 'never'}`);
    if (s.offers.length) {
      lines.push('');
      lines.push(`🔥 ${s.offers.length} OFFER${s.offers.length > 1 ? 'S' : ''} WAITING:`);
      for (const o of s.offers) {
        const t = o.terms ?? {};
        lines.push(`- ${o.name}: ${o.summary}`);
        lines.push(`  money: ${t.money ?? '—'} · rights: ${t.rights ?? '—'} · term: ${t.term_length ?? '—'} · exclusivity: ${t.exclusivity ?? '—'}`);
      }
      lines.push('Not legal advice — have contracts reviewed before signing.');
    }
    console.log(lines.join('\n'));
    return;
  }

  // open (default)
  const v = claudeInstalled();
  if (!v) console.log('Warning: the `claude` command was not found on PATH. Autoreach will show setup steps.');
  const state = await start();
  if (!state) {
    console.log(`Autoreach did not start. Check ${path.join(HOME, 'logs')}`);
    process.exitCode = 1;
    return;
  }
  const url = `${BASE}/?t=${token()}`;
  const open = process.env.AUTOREACH_NO_OPEN !== '1';
  if (open) openBrowser(url);
  const where = open ? ' (opened in your browser)' : '';
  console.log(state === 'autoreach' ? `Autoreach is running at ${BASE}${where}.` : `Autoreach is setting itself up for the first time at ${BASE}${where}. The page opens the app when it's ready, in about 30 seconds.`);
}

main().catch((e) => {
  console.error(`Autoreach: ${e.message}`);
  process.exitCode = 1;
});
