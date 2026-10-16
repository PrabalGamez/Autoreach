#!/usr/bin/env node
// Demo/QA mode: fake Claude + in-memory Gmail + separate data folder. Never touches your real data or inbox.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.AUTOREACH_HOME ??= path.join(os.tmpdir(), 'autoreach-demo');
process.env.AUTOREACH_PORT ??= '4748';
process.env.AUTOREACH_FAKE_GMAIL = '1';
process.env.AUTOREACH_SECRETS = 'memory';
process.env.AUTOREACH_CLAUDE_BIN ??= path.join(root, 'tests', 'fake-claude.mjs');
process.env.FAKE_CLAUDE_DELAY_MS ??= '1200';
register();
await import(pathToFileURL(path.join(root, 'server', 'index.ts')).href);
