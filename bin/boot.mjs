#!/usr/bin/env node
// Started detached by bin/autoreach.mjs. Gets the app ready and starts the server.
// Uses only Node built-ins so it runs straight from the plugin copy, which has no node_modules.
//
// Claude Code installs plugins as a copy without node_modules, and replaces that copy on update.
// So the app runs from ~/.autoreach/app: code is synced there on every start, and production
// dependencies are installed there once per lockfile. The first install shows a setup page on
// the app's own port, so the browser opens instantly and simply reloads into the app when ready.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = process.env.AUTOREACH_HOME ?? path.join(os.homedir(), '.autoreach');
const PORT = Number(process.env.AUTOREACH_PORT ?? 4747);
const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = path.join(HOME, 'app');
const LOGS = path.join(HOME, 'logs');
const CODE = ['server', 'shared', 'dist', 'package.json', 'package-lock.json', 'tsconfig.json'];
const isWin = process.platform === 'win32';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hasDeps = (dir) => fs.existsSync(path.join(dir, 'node_modules', 'tsx', 'package.json'));
const isApp = (dir) => !!dir && fs.existsSync(path.join(dir, 'server', 'index.ts'));
const tail = (file, n = 30) => {
  try {
    return fs.readFileSync(file, 'utf8').trim().split('\n').slice(-n).join('\n');
  } catch {
    return '';
  }
};

fs.mkdirSync(LOGS, { recursive: true });
const bootLog = path.join(LOGS, 'setup.log');
const log = (line) => fs.appendFileSync(bootLog, `[${new Date().toISOString()}] ${line}\n`);

/** A developer checkout that already has its dependencies (AUTOREACH_APP_ROOT or ~/.autoreach/app-root). */
function devRoot() {
  const c = [process.env.AUTOREACH_APP_ROOT];
  try {
    c.push(fs.readFileSync(path.join(HOME, 'app-root'), 'utf8').trim());
  } catch {
    /* not set */
  }
  if (hasDeps(SELF_ROOT)) c.push(SELF_ROOT);
  return c.find((d) => isApp(d) && hasDeps(d)) ?? null;
}

const lockHash = () => crypto.createHash('sha256').update(fs.readFileSync(path.join(SELF_ROOT, 'package-lock.json'))).digest('hex').slice(0, 16);
const depsMarker = () => path.join(RUNTIME, 'node_modules', `.autoreach-${lockHash()}-${process.version}`);

function syncCode() {
  fs.mkdirSync(RUNTIME, { recursive: true });
  for (const item of CODE) {
    const from = path.join(SELF_ROOT, item);
    if (!fs.existsSync(from)) continue;
    fs.rmSync(path.join(RUNTIME, item), { recursive: true, force: true });
    fs.cpSync(from, path.join(RUNTIME, item), { recursive: true });
  }
}

// ---------- setup page (only shown during the first install) ----------

const state = { step: 'copy', error: null, detail: '' };

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Setting up Autoreach</title>
<style>
:root{--forest:#0c1d13;--forest2:#142a1e;--lime:#9fe870;--cream:#ecebe1;--muted:rgba(236,235,225,.62);--ember:#f26522}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--forest);color:var(--cream);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px}
main{width:100%;max-width:520px}.mark{width:44px;height:44px;border-radius:8px;background:var(--lime);display:grid;place-items:center;color:var(--forest);font-weight:800;font-size:22px}
h1{font-size:40px;line-height:1.05;letter-spacing:-.02em;margin:28px 0 10px;font-weight:750}p{color:var(--muted);margin:0}
ol{list-style:none;padding:0;margin:32px 0 0;display:grid;gap:10px}li{display:flex;gap:12px;align-items:center;background:var(--forest2);border-radius:8px;padding:14px 16px;color:var(--muted)}
.dot{width:18px;height:18px;border-radius:50%;border:2px solid rgba(236,235,225,.25);flex:none}
li.on{color:var(--cream)}li.on .dot{border-color:var(--lime);border-top-color:transparent;animation:spin .8s linear infinite}
li.bad{color:var(--cream)}li.bad .dot{background:var(--ember);border-color:var(--ember)}li.done{color:var(--cream)}li.done .dot{background:var(--lime);border-color:var(--lime)}
.err{display:none;margin-top:24px;background:#2a1410;border:1px solid var(--ember);border-radius:8px;padding:16px}.err b{color:#ffb595}
pre{white-space:pre-wrap;font:12px/1.5 ui-monospace,Menlo,monospace;color:var(--muted);max-height:220px;overflow:auto;margin:10px 0 0}
@keyframes spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){li.on .dot{animation:none;border-top-color:var(--lime)}}
</style></head><body><main>
<div class="mark" aria-hidden="true">A</div>
<h1>Setting up Autoreach</h1>
<p>First run only. This takes about 30 seconds, and this page opens the app by itself when it's done.</p>
<ol id="steps" aria-live="polite">
<li data-s="copy"><span class="dot"></span>Copying the app</li>
<li data-s="install"><span class="dot"></span>Installing its parts</li>
<li data-s="start"><span class="dot"></span>Starting up</li>
</ol>
<div class="err" id="err" role="alert"><b>Setup failed.</b> <span id="msg"></span><pre id="log"></pre></div>
</main><script>
const order=['copy','install','start'];
async function tick(){
  try{
    const r=await fetch('/api/ping',{cache:'no-store'});const j=await r.json();
    if(j.app==='autoreach'){location.reload();return}
    const i=order.indexOf(j.step);
    document.querySelectorAll('#steps li').forEach((li,k)=>{li.className=k<i?'done':k===i?(j.error?'bad':'on'):''});
    if(j.error){document.getElementById('err').style.display='block';document.getElementById('msg').textContent=j.error;document.getElementById('log').textContent=j.detail||'';return}
  }catch(e){/* server switching over */}
  setTimeout(tick,800);
}
tick();
</script></body></html>`;

function setupServer() {
  const hosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
  const srv = http.createServer((req, res) => {
    if (!hosts.has(req.headers.host ?? '')) return res.writeHead(403).end();
    if (req.url?.startsWith('/api/ping')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ app: 'autoreach-setup', ...state }));
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(PAGE);
  });
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

// ---------- install and start ----------

function npmInstall() {
  return new Promise((resolve, reject) => {
    const out = fs.openSync(bootLog, 'a');
    const args = ['ci', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error', '--update-notifier=false', '--cache', path.join(HOME, 'npm-cache')];
    // On Windows, run npm's own script with Node: no cmd.exe, so paths with spaces stay intact.
    const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const [cmd, argv] = isWin && fs.existsSync(npmCli) ? [process.execPath, [npmCli, ...args]] : [isWin ? 'npm.cmd' : 'npm', args];
    const child = spawn(cmd, argv, { cwd: RUNTIME, stdio: ['ignore', out, out], shell: isWin && cmd !== process.execPath });
    child.on('error', () => reject(new Error('npm was not found. Install Node.js 22.13 or newer from nodejs.org, then run /autoreach again.')));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Installing dependencies failed (npm exit ${code}).`))));
  });
}

async function ping() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/ping`, { signal: AbortSignal.timeout(1500) });
    return (await r.json()).app === 'autoreach';
  } catch {
    return false;
  }
}

async function startServer(root) {
  const serverLog = path.join(LOGS, 'server.out');
  const out = fs.openSync(serverLog, 'a');
  const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs');
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', tsx, path.join(root, 'server', 'index.ts')], {
    cwd: root,
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, AUTOREACH_HOME: HOME, AUTOREACH_PORT: String(PORT) },
  });
  child.unref();
  let exited = false;
  child.once('exit', () => (exited = true));
  for (let i = 0; i < 80 && !exited; i++) {
    await sleep(250);
    if (await ping()) return;
  }
  throw Object.assign(new Error('The app did not start.'), { detail: tail(serverLog) });
}

/** The app stores data with Node's built-in SQLite (nothing to compile), which needs Node 22.13+. */
async function nodeTooOld() {
  try {
    await import('node:sqlite');
    return null;
  } catch {
    return `Autoreach needs Node.js 22.13 or newer, and this computer has ${process.version}. Install the LTS version from nodejs.org, then run /autoreach again.`;
  }
}

async function main() {
  const old = await nodeTooOld();
  if (old) {
    state.error = old;
    await setupServer();
    setTimeout(() => process.exit(1), 10 * 60_000);
    return;
  }
  const dev = devRoot();
  if (dev) {
    if (!fs.existsSync(path.join(dev, 'dist', 'web', 'index.html'))) spawnSync(isWin ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: dev, stdio: 'ignore', shell: isWin });
    return startServer(dev);
  }

  if (fs.existsSync(depsMarker())) {
    syncCode();
    return startServer(RUNTIME);
  }

  // First run (or new dependencies): show the setup page while installing.
  const srv = await setupServer();
  try {
    fs.writeFileSync(bootLog, '');
    log(`setup from ${SELF_ROOT} (node ${process.version})`);
    syncCode();
    state.step = 'install';
    fs.rmSync(path.join(RUNTIME, 'node_modules'), { recursive: true, force: true });
    await npmInstall();
    fs.writeFileSync(depsMarker(), new Date().toISOString());
    state.step = 'start';
    const closed = new Promise((r) => srv.close(r));
    srv.closeAllConnections();
    await closed;
    await startServer(RUNTIME);
    log('ready');
  } catch (e) {
    log(`failed: ${e.message}`);
    state.error = e.message;
    if (/gyp|python|Visual Studio/i.test(tail(bootLog, 200))) state.error += ' A part tried to compile from source. Update Node.js to the latest LTS from nodejs.org, then run /autoreach again.';
    state.detail = e.detail ?? tail(bootLog);
    // Keep explaining the failure for a while, unless the port is already free again.
    if (!srv.listening) await setupServer().catch(() => null);
    setTimeout(() => process.exit(1), 10 * 60_000).unref();
    await sleep(10 * 60_000);
  }
}

main().catch((e) => {
  log(`boot error: ${e.message}`);
  process.exit(1);
});
