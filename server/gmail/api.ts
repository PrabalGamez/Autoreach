import { FAKE_GMAIL } from '../config.ts';
import { getAccessToken, invalidateAccessToken, GmailAuthError } from './oauth.ts';
import { getState, setState } from '../db/index.ts';

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  internalDate: string;
  headers: Record<string, string>;
  text: string;
  snippet: string;
}

export interface GmailApi {
  profile(): Promise<{ emailAddress: string; historyId: string }>;
  sendRaw(raw: string, threadId?: string): Promise<{ id: string; threadId: string }>;
  getMessage(id: string): Promise<GmailMessage>;
  history(startHistoryId: string): Promise<{ messageIds: { id: string; threadId: string }[]; historyId: string } | 'expired'>;
  threadMessageIds(threadId: string): Promise<{ id: string; threadId: string }[]>;
}

// ---------- real ----------
const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function call<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (res.status === 401 && !retried) {
    invalidateAccessToken();
    return call<T>(path, init, true);
  }
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Gmail ${res.status}: ${text.slice(0, 300)}`) as Error & { status?: number };
    err.status = res.status;
    if (res.status === 401 || res.status === 403) throw new GmailAuthError(err.message);
    throw err;
  }
  return (await res.json()) as T;
}

function b64urlDecode(s: string) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

interface Part {
  mimeType: string;
  body?: { data?: string };
  parts?: Part[];
  headers?: { name: string; value: string }[];
}

function extractText(p: Part): string {
  if (p.mimeType === 'text/plain' && p.body?.data) return b64urlDecode(p.body.data);
  for (const c of p.parts ?? []) {
    const t = extractText(c);
    if (t) return t;
  }
  if (p.mimeType === 'text/html' && p.body?.data)
    return b64urlDecode(p.body.data).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return '';
}

/** Drop quoted history ("On ... wrote:" and "> " lines) so the classifier sees the new text. */
export function stripQuoted(text: string) {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const l of lines) {
    if (/^On .+wrote:\s*$/.test(l) || /^-{2,}\s*Original Message/i.test(l) || /^From: .+/.test(l)) break;
    if (l.startsWith('>')) continue;
    out.push(l);
  }
  return out.join('\n').trim();
}

const real: GmailApi = {
  profile: () => call('/profile'),
  sendRaw: (raw, threadId) => call('/messages/send', { method: 'POST', body: JSON.stringify(threadId ? { raw, threadId } : { raw }) }),
  async getMessage(id) {
    const m = await call<{ id: string; threadId: string; labelIds?: string[]; internalDate: string; snippet: string; payload: Part }>(`/messages/${id}?format=full`);
    const headers: Record<string, string> = {};
    for (const h of m.payload.headers ?? []) headers[h.name.toLowerCase()] = h.value;
    return { id: m.id, threadId: m.threadId, labelIds: m.labelIds ?? [], internalDate: m.internalDate, headers, text: extractText(m.payload), snippet: m.snippet };
  },
  async history(startHistoryId) {
    const ids: { id: string; threadId: string }[] = [];
    let pageToken: string | undefined;
    let historyId = startHistoryId;
    try {
      do {
        const q = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded', maxResults: '500' });
        if (pageToken) q.set('pageToken', pageToken);
        const r = await call<{ history?: { messagesAdded?: { message: { id: string; threadId: string } }[] }[]; historyId: string; nextPageToken?: string }>(`/history?${q}`);
        for (const h of r.history ?? []) for (const a of h.messagesAdded ?? []) ids.push({ id: a.message.id, threadId: a.message.threadId });
        historyId = r.historyId;
        pageToken = r.nextPageToken;
      } while (pageToken);
    } catch (err) {
      if ((err as { status?: number }).status === 404) return 'expired';
      throw err;
    }
    return { messageIds: ids, historyId };
  },
  async threadMessageIds(threadId) {
    const t = await call<{ messages: { id: string; threadId: string }[] }>(`/threads/${threadId}?format=minimal`);
    return t.messages.map((m) => ({ id: m.id, threadId: m.threadId }));
  },
};

// ---------- fake (tests and demo) ----------
interface FakeMsg extends GmailMessage {
  history: number;
}
const fakeStore: { msgs: FakeMsg[]; history: number } = { msgs: [], history: 1000 };
export const FAKE_SELF = 'you@example.test';

export const fakeGmail: GmailApi & {
  inject(m: { threadId: string; from: string; subject: string; text: string }): string;
  sent(): FakeMsg[];
  reset(): void;
} = {
  async profile() {
    return { emailAddress: getState('fake_gmail_email') ?? FAKE_SELF, historyId: String(fakeStore.history) };
  },
  async sendRaw(raw, threadId) {
    const decoded = b64urlDecode(raw);
    const [head, ...rest] = decoded.split('\r\n\r\n');
    const headers: Record<string, string> = {};
    for (const line of head.split('\r\n')) {
      const i = line.indexOf(':');
      if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
    }
    const id = `fake-${++fakeStore.history}`;
    const body = rest.join('\r\n\r\n');
    const text = headers['content-transfer-encoding'] === 'base64' ? Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8') : body;
    fakeStore.msgs.push({ id, threadId: threadId ?? `thread-${id}`, labelIds: ['SENT'], internalDate: String(Date.now()), headers, text, snippet: text.slice(0, 100), history: fakeStore.history });
    return { id, threadId: threadId ?? `thread-${id}` };
  },
  async getMessage(id) {
    const m = fakeStore.msgs.find((x) => x.id === id);
    if (!m) throw new Error('not found');
    return m;
  },
  async history(start) {
    const s = Number(start);
    return { messageIds: fakeStore.msgs.filter((m) => m.history > s).map((m) => ({ id: m.id, threadId: m.threadId })), historyId: String(fakeStore.history) };
  },
  async threadMessageIds(threadId) {
    return fakeStore.msgs.filter((m) => m.threadId === threadId).map((m) => ({ id: m.id, threadId }));
  },
  inject({ threadId, from, subject, text }) {
    const id = `fake-${++fakeStore.history}`;
    fakeStore.msgs.push({ id, threadId, labelIds: ['INBOX'], internalDate: String(Date.now()), headers: { from, subject, 'message-id': `<${id}@example.test>` }, text, snippet: text.slice(0, 100), history: fakeStore.history });
    return id;
  },
  sent: () => fakeStore.msgs.filter((m) => m.labelIds.includes('SENT')),
  reset() {
    fakeStore.msgs = [];
    fakeStore.history = 1000;
  },
};

export function gmail(): GmailApi {
  return FAKE_GMAIL ? fakeGmail : real;
}

export function connectFake(email: string) {
  setState('fake_gmail_connected', '1');
  setState('fake_gmail_email', email);
}
