#!/usr/bin/env node
// Launcher for the /autoreach slash command: start (default) | status | stop
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = process.env.AUTOREACH_HOME ?? path.join(os.homedir(), '.autoreach');
const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_ROOT_FILE = path.join(HOME, 'app-root');
const hasDeps = (dir) => fs.existsSync(path.join(dir, 'node_modules', 'tsx', 'package.json'));

/**
 * Claude Code installs plugins as a copy without node_modules. Prefer the full checkout
 * recorded in ~/.autoreach/app-root; otherwise run from wherever this file lives.
 */
function resolveRoot() {
  const candidates = [process.env.AUTOREACH_APP_ROOT];
  try {
    candidates.push(fs.readFileSync(APP_ROOT_FILE, 'utf8').trim());
  } catch {
    /* not recorded yet */
  }
  candidates.push(SELF_ROOT);
  return candidates.find((d) => d && fs.existsSync(path.join(d, 'server', 'index.ts')) && hasDeps(d)) ?? SELF_ROOT;
}
const ROOT = resolveRoot();
const PORT = Number(process.env.AUTOREACH_PORT ?? 4747);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN_PATH = path.join(HOME, 'session');
const PID_PATH = path.join(HOME, 'server.pid');
const cmd = (process.argv[2] ?? 'open').toLowerCase();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = () => (fs.existsSync(TOKEN_PATH) ? fs.readFileSync(TOKEN_PATH, 'utf8').trim() : '');

async function ping() {
  try {
    const r = await fetch(`${BASE}/api/ping`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    return j.app === 'autoreach';
  } catch {
    return false;
  }
}

async function api(p, init = {}) {
  const r = await fetch(`${BASE}${p}`, { ...init, headers: { 'x-autoreach-token': token(), 'content-type': 'application/json', ...(init.headers ?? {}) } });
  return r.json();
}

function run(command, args) {
  const r = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

function ensureBuilt() {
  if (!hasDeps(ROOT)) {
    console.log('First run: installing dependencies…');
    run('npm', ['install', '--no-audit', '--no-fund']);
  }
  if (!fs.existsSync(path.join(ROOT, 'dist', 'web', 'index.html'))) {
    console.log('First run: building the app…');
    run('npm', ['run', 'build']);
  }
}

function claudeInstalled() {
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

async function start() {
  if (await ping()) return true;
  ensureBuilt();
  fs.mkdirSync(path.join(HOME, 'logs'), { recursive: true });
  const out = fs.openSync(path.join(HOME, 'logs', 'server.out'), 'a');
  const tsx = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs');
  const child = spawn(process.execPath, ['--import', tsx, path.join(ROOT, 'server', 'index.ts')], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, AUTOREACH_HOME: HOME, AUTOREACH_PORT: String(PORT) },
  });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (await ping()) return true;
  }
  console.log(`Autoreach did not start. Check ${path.join(HOME, 'logs', 'server.out')}`);
  return false;
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
  if (!(await start())) {
    process.exitCode = 1;
    return;
  }
  if (hasDeps(ROOT)) fs.writeFileSync(APP_ROOT_FILE, ROOT);
  const url = `${BASE}/?t=${token()}`;
  const open = process.env.AUTOREACH_NO_OPEN !== '1';
  if (open) openBrowser(url);
  console.log(`Autoreach is running at ${BASE}${open ? ' (opened in your browser)' : ''}.`);
}

main().catch((e) => {
  console.error(`Autoreach: ${e.message}`);
  process.exitCode = 1;
});
