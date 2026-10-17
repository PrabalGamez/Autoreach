import fs from 'node:fs';
import { HOST, PID_PATH, PORT, ensureHome } from './config.ts';
import { openDb } from './db/index.ts';
import { createSessionToken } from './security.ts';
import { buildApp } from './app.ts';
import { markStaleJobs } from './claude/runner.ts';
import { checkClaude } from './claude/health.ts';
import { startScheduler, stopScheduler } from './jobs/scheduler.ts';
import { log } from './log.ts';

ensureHome();
openDb();
markStaleJobs();
const token = createSessionToken();

let app: Awaited<ReturnType<typeof buildApp>>;
const shutdown = async () => {
  stopScheduler();
  try {
    fs.rmSync(PID_PATH, { force: true });
  } catch {
    /* ignore */
  }
  await app?.close();
  process.exit(0);
};

app = await buildApp(token, { onShutdown: shutdown });
await app.listen({ host: HOST, port: PORT });
fs.writeFileSync(PID_PATH, String(process.pid));
log.info(`Autoreach listening on http://${HOST}:${PORT}`);

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Health check at boot; blocking screen in the UI reads the result.
checkClaude(true, { liftPause: true }).then((h) => log.info(`Claude Code: ${h.ok ? `ok (${h.version})` : `NOT READY: ${h.error}`}`));
startScheduler();
