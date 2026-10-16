import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { installSecurity } from './security.ts';
import { coreRoutes } from './routes/core.ts';
import { targetRoutes } from './routes/targets.ts';
import { insightRoutes } from './routes/insights.ts';
import { ClaudeAuthError, ClaudeTaskError } from './claude/runner.ts';
import { GmailAuthError } from './gmail/oauth.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildApp(token: string, opts: { port?: number; onShutdown?: () => void } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cookie);
  installSecurity(app, token, opts.port);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') });
    if (err instanceof ClaudeAuthError) return reply.code(503).send({ error: err.message, kind: 'claude_auth' });
    if (err instanceof GmailAuthError) return reply.code(503).send({ error: err.message, kind: 'gmail_auth' });
    if (err instanceof ClaudeTaskError) return reply.code(502).send({ error: err.message, kind: 'claude_task' });
    const e = err as Error & { statusCode?: number };
    return reply.code(e.statusCode ?? 500).send({ error: e.message });
  });

  await app.register(coreRoutes);
  await app.register(targetRoutes);
  await app.register(async (a) => insightRoutes(a, { onShutdown: opts.onShutdown ?? (() => process.exit(0)) }));

  const webDist = path.join(root, 'dist', 'web');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
