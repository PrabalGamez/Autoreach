import { OPT_OUT_LINE } from './claude/tasks.ts';

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

function trigrams(s: string): Set<string> {
  const words = s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

/** Jaccard similarity of word trigrams, 0..1. */
export function similarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export function withOptOut(body: string): string {
  const clean = body.replace(/\s+$/, '');
  if (clean.includes(OPT_OUT_LINE)) return clean;
  return `${clean}\n\n${OPT_OUT_LINE}`;
}

export interface DraftProblem {
  problem: string;
}

/** Code-side checks. Returns a problem description, or null when the draft passes. */
export function checkDraft(d: { subject: string; body: string; unique_reference: string }, others: string[], maxWords = 150): string | null {
  const body = withOptOut(d.body);
  if (wordCount(body) > maxWords) return `Body is ${wordCount(body)} words including the opt-out line; must be under ${maxWords}. Cut it down.`;
  if (!d.unique_reference.trim() || !d.body.toLowerCase().includes(d.unique_reference.trim().toLowerCase()))
    return 'unique_reference must appear verbatim in the body.';
  if (/\b(lorem|\[name\]|\{\{|\[insert)/i.test(d.body + d.subject)) return 'Draft contains placeholder text.';
  const worst = Math.max(0, ...others.map((o) => similarity(o, d.body)));
  if (worst > 0.35) return 'Draft is too similar to another draft. Change structure and wording so it reads as written only for this recipient.';
  return null;
}
