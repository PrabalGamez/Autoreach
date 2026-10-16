import fs from 'node:fs';
import path from 'node:path';
import { LOG_DIR } from './config.ts';

function write(level: string, msg: string) {
  const line = `${new Date().toISOString()} ${level} ${msg}\n`;
  if (process.env.VITEST) return;
  process.stdout.write(line);
  try {
    fs.appendFileSync(path.join(LOG_DIR, 'autoreach.log'), line);
  } catch {
    /* log dir missing during early boot */
  }
}

export const log = {
  info: (m: string) => write('INFO', m),
  warn: (m: string) => write('WARN', m),
  error: (m: string) => write('ERROR', m),
};
