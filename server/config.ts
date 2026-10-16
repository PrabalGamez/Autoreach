import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const HOME = process.env.AUTOREACH_HOME ?? path.join(os.homedir(), '.autoreach');
export const PORT = Number(process.env.AUTOREACH_PORT ?? 4747);
export const HOST = '127.0.0.1';
export const ORIGIN = `http://${HOST}:${PORT}`;
export const DB_PATH = path.join(HOME, 'autoreach.db');
export const PID_PATH = path.join(HOME, 'server.pid');
export const TOKEN_PATH = path.join(HOME, 'session');
export const LOG_DIR = path.join(HOME, 'logs');
export const CLAUDE_BIN = process.env.AUTOREACH_CLAUDE_BIN ?? 'claude';
/** Test/demo switch: replaces Gmail network calls with an in-memory mailbox. */
export const FAKE_GMAIL = process.env.AUTOREACH_FAKE_GMAIL === '1';

export const HARD_DAILY_CAP = 50;
export const OAUTH_REDIRECT = `${ORIGIN}/oauth/google/callback`;
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'openid',
  'email',
];

export function ensureHome() {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
}
