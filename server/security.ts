import crypto from 'node:crypto';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { PORT, TOKEN_PATH } from './config.ts';

export const SESSION_COOKIE = 'ar_session';

export function createSessionToken(write = true) {
  const token = crypto.randomBytes(24).toString('hex');
  if (write) fs.writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
  return token;
}

function safeEqual(a: string | undefined, b: string) {
  if (!a || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const allowedHosts = (port: number) => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const allowedOrigins = (port: number) => new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

/**
 * Local-only hardening:
 * - Host header must be loopback (blocks DNS-rebinding).
 * - API calls need the session token (cookie set by the launcher URL, or header).
 * - State-changing calls must come from our own origin (blocks cross-site requests).
 */
export function installSecurity(app: FastifyInstance, token: string, port = PORT) {
  const hosts = allowedHosts(port);
  const origins = allowedOrigins(port);
  if (process.env.AUTOREACH_DEV === '1') {
    hosts.add('127.0.0.1:5173');
    hosts.add('localhost:5173');
    origins.add('http://127.0.0.1:5173');
    origins.add('http://localhost:5173');
  }

  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host ?? '';
    if (!hosts.has(host)) return reply.code(403).send({ error: 'Forbidden host' });

    const url = req.url.split('?')[0];
    // One canonical host so the session cookie survives the OAuth round-trip (redirect URI is 127.0.0.1).
    if (req.method === 'GET' && host === `localhost:${port}` && !url.startsWith('/api/')) return reply.redirect(`http://127.0.0.1:${port}${req.url}`);
    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
      const t = (req.query as Record<string, string>)?.t;
      if (safeEqual(t, token)) {
        reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'strict' });
        return reply.redirect('/');
      }
      return;
    }
    if (!url.startsWith('/api/') || url === '/api/ping') return;

    const supplied = req.cookies?.[SESSION_COOKIE] ?? (req.headers['x-autoreach-token'] as string | undefined);
    if (!safeEqual(supplied, token)) return reply.code(401).send({ error: 'Open Autoreach with /autoreach to get a session.' });

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin && !origins.has(origin)) return reply.code(403).send({ error: 'Forbidden origin' });
    }
  });
}
