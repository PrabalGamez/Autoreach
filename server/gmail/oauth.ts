import crypto from 'node:crypto';
import { GMAIL_SCOPES, OAUTH_REDIRECT, FAKE_GMAIL } from '../config.ts';
import { getSecret, setSecret, deleteSecret } from '../secrets.ts';
import { getState, setState, pause, nowIso } from '../db/index.ts';

export class GmailAuthError extends Error {}

const pending = new Map<string, { verifier: string; expires: number }>();
let access: { token: string; expires: number } | null = null;

export function saveClient(clientId: string, clientSecret: string) {
  setSecret('google_client_id', clientId.trim());
  setSecret('google_client_secret', clientSecret.trim());
}

export function hasClient() {
  return FAKE_GMAIL || Boolean(getSecret('google_client_id') && getSecret('google_client_secret'));
}

export function isConnected() {
  return FAKE_GMAIL ? getState('fake_gmail_connected') === '1' : Boolean(getSecret('google_refresh_token'));
}

export function buildAuthUrl(): string {
  const clientId = getSecret('google_client_id');
  if (!clientId) throw new GmailAuthError('Add your Google OAuth client ID and secret first.');
  const state = crypto.randomBytes(16).toString('hex');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  pending.set(state, { verifier, expires: Date.now() + 10 * 60_000 });
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: OAUTH_REDIRECT,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const json = (await res.json()) as Record<string, string | number>;
  if (!res.ok) throw new GmailAuthError(String(json.error_description ?? json.error ?? res.statusText));
  return json;
}

export async function handleCallback(code: string, state: string) {
  const entry = pending.get(state);
  pending.delete(state);
  if (!entry || entry.expires < Date.now()) throw new GmailAuthError('Sign-in link expired. Start again.');
  const json = await tokenRequest({
    code,
    client_id: getSecret('google_client_id') ?? '',
    client_secret: getSecret('google_client_secret') ?? '',
    redirect_uri: OAUTH_REDIRECT,
    grant_type: 'authorization_code',
    code_verifier: entry.verifier,
  });
  if (!json.refresh_token) throw new GmailAuthError('Google did not return a refresh token. Remove Autoreach from your Google account permissions and connect again.');
  setSecret('google_refresh_token', String(json.refresh_token));
  access = { token: String(json.access_token), expires: Date.now() + (Number(json.expires_in) - 60) * 1000 };
  const scopes = String(json.scope ?? '');
  if (!scopes.includes('gmail.send') || !scopes.includes('gmail.readonly'))
    throw new GmailAuthError('Both "send" and "read" Gmail permissions are needed. Tick both boxes on the Google consent screen.');
  setState('gmail_error', null);
}

export async function getAccessToken(): Promise<string> {
  if (access && access.expires > Date.now()) return access.token;
  const refresh = getSecret('google_refresh_token');
  if (!refresh) throw new GmailAuthError('Gmail is not connected.');
  try {
    const json = await tokenRequest({
      client_id: getSecret('google_client_id') ?? '',
      client_secret: getSecret('google_client_secret') ?? '',
      refresh_token: refresh,
      grant_type: 'refresh_token',
    });
    access = { token: String(json.access_token), expires: Date.now() + (Number(json.expires_in) - 60) * 1000 };
    return access.token;
  } catch (err) {
    const msg = `Gmail sign-in failed: ${(err as Error).message}. Reconnect Gmail in Settings.`;
    setState('gmail_error', msg);
    setState('gmail_error_at', nowIso());
    pause(msg);
    throw new GmailAuthError(msg);
  }
}

export function disconnect() {
  deleteSecret('google_refresh_token');
  access = null;
  setState('fake_gmail_connected', null);
}

export function invalidateAccessToken() {
  access = null;
}
