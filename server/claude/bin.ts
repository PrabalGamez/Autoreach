import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_BIN } from '../config.ts';

let cached: { cmd: string; pre: string[] } | null = null;

/**
 * How to start the `claude` CLI. On Windows, Node can only spawn .exe files without a shell, and the
 * npm install of Claude Code is a claude.cmd shim. Going through cmd.exe would mangle the prompts and
 * JSON schemas we pass as arguments, so for the shim we run its JavaScript entry with Node directly.
 */
export function claudeCommand() {
  if (cached) return cached;
  cached = { cmd: CLAUDE_BIN, pre: [] };
  if (process.platform !== 'win32' || process.env.AUTOREACH_CLAUDE_BIN) return cached;
  const found = spawnSync('where', ['claude'], { encoding: 'utf8' }).stdout?.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) ?? [];
  const exe = found.find((f) => f.toLowerCase().endsWith('.exe'));
  if (exe) return (cached = { cmd: exe, pre: [] });
  const shim = found.find((f) => f.toLowerCase().endsWith('.cmd'));
  if (shim) {
    const pkg = path.join(path.dirname(shim), 'node_modules', '@anthropic-ai', 'claude-code');
    const entry = ['cli.js', 'cli.mjs'].map((f) => path.join(pkg, f)).find((f) => fs.existsSync(f));
    if (entry) cached = { cmd: process.execPath, pre: [entry] };
  }
  return cached;
}
