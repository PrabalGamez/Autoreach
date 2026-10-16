import { defineConfig } from 'vitest/config';
import path from 'node:path';
import os from 'node:os';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 20000,
    env: {
      AUTOREACH_HOME: path.join(os.tmpdir(), 'autoreach-test-home'),
      AUTOREACH_CLAUDE_BIN: path.resolve('tests/fake-claude.mjs'),
      AUTOREACH_FAKE_GMAIL: '1',
      AUTOREACH_SECRETS: 'memory',
      AUTOREACH_PORT: '4799',
    },
  },
});
