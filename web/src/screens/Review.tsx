import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowLeft, ArrowRight, Copy, ExternalLink, Link2, Pencil, RefreshCw, Trash2, Users } from 'lucide-react';
import type { ReviewCard } from '../../../shared/types.ts';
import { Badge, Button, Empty, Input, Kbd, Monogram, TextArea, TwoTone, cx, useToast } from '../components/ui.tsx';
import { api, patch, post } from '../lib/api.ts';
import type { Route } from '../components/Shell.tsx';

type Exit = 'approve' | 'skip' | 'discard' | null;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const KIND_LABEL = { initial: 'First email', followup: 'Follow-up', intro_request: 'Intro request', reply: 'Reply to offer' } as const;

export function Review({ onChange, go, mode }: { onChange: () => void; go: (r: Route) => void; mode: 'gmail_web' | 'gmail_api' }) {
  const toast = useToast();
  const [deck, setDeck] = useState<ReviewCard[] | null>(null);
  const [reviewed, setReviewed] = useState(0);
  const [exit, setExit] = useState<Exit>(null);
  const [editing, setEditing] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenNote, setRegenNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [draftEdit, setDraftEdit] = useState<{ subject: string; body: string } | null>(null);
  const [handedOff, setHandedOff] = useState<{ url: string; to: string; opened: boolean } | null>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const regenRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const cards = await api<ReviewCard[]>('/api/review');
    setDeck((cur) => {
      if (!cur) return cards;
      const have = new Set(cur.map((c) => c.draft.id));
      const fresh = cards.filter((c) => !have.has(c.draft.id));
      if (!fresh.length) return cur;
      // Replies to offers jump the queue (behind the card you're looking at).
      const urgent = fresh.filter((c) => c.draft.kind === 'reply');
      const rest = fresh.filter((c) => c.draft.kind !== 'reply');
      return cur.length ? [cur[0], ...urgent, ...cur.slice(1), ...rest] : [...urgent, ...rest];
    });
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 6000);
    return () => clearInterval(id);
  }, [load]);

  const card = deck?.[0] ?? null;
  const total = reviewed + (deck?.length ?? 0);
  useEffect(() => {
    setDraftEdit(card ? { subject: card.draft.subject, body: card.draft.body } : null);
    setEditing(false);
    setRegenOpen(false);
    setRegenNote('');
  }, [card?.draft.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = card && draftEdit && (draftEdit.subject !== card.draft.subject || draftEdit.body !== card.draft.body);

  const advance = (kind: Exit, requeue = false) => {
    setExit(kind);
    setDeck((d) => {
      if (!d) return d;
      const [first, ...rest] = d;
      return requeue ? [...rest, first] : rest;
    });
    if (!requeue) setReviewed((n) => n + 1);
    onChange();
  };

  const approve = async () => {
    if (!card || !draftEdit || busy) return;
    const formOnly = card.target?.route === 'form_only' && card.draft.kind !== 'intro_request';
    // Gmail web mode: open the window now, inside the key press or click, so the browser does not block it.
    const gmailWin = !formOnly && mode === 'gmail_web' ? window.open('about:blank', '_blank') : null;
    setBusy('approve');
    try {
      if (formOnly) {
        await navigator.clipboard.writeText(`${draftEdit.subject}\n\n${draftEdit.body}`).catch(() => {});
      }
      const r = await post<{ formUrl?: string; composeUrl?: string }>(`/api/drafts/${card.draft.id}/approve`, draftEdit);
      if (formOnly) {
        if (r.formUrl) window.open(r.formUrl, '_blank', 'noopener');
        toast(`Copied. Paste it into ${card.target?.name}'s form.`, 'good');
      } else if (r.composeUrl) {
        let opened = false;
        if (gmailWin) {
          gmailWin.opener = null;
          gmailWin.location.href = r.composeUrl;
          opened = true;
        } else opened = Boolean(window.open(r.composeUrl, '_blank', 'noopener'));
        // Keep a link on screen in case a popup blocker stopped the window.
        setHandedOff({ url: r.composeUrl, to: card.to ?? '', opened });
        toast(opened ? 'Opened in Gmail. Check it and press Send.' : 'Your browser blocked the Gmail window. Use the link above the card.', opened ? 'good' : 'error');
      } else toast(`Approved. Queued to ${card.to}.`, 'good');
      advance('approve');
    } catch (e) {
      gmailWin?.close();
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const skip = async () => {
    if (!card || busy) return;
    if (dirty) await patch(`/api/drafts/${card.draft.id}`, draftEdit).catch(() => {});
    await post(`/api/drafts/${card.draft.id}/skip`).catch(() => {});
    advance('skip', true);
  };

  const discard = async () => {
    if (!card || busy) return;
    setBusy('discard');
    try {
      await post(`/api/drafts/${card.draft.id}/discard`);
      advance('discard');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const regenerate = async () => {
    if (!card || busy) return;
    setBusy('regen');
    try {
      const d = await post<ReviewCard['draft']>(`/api/drafts/${card.draft.id}/regenerate`, { note: regenNote || undefined });
      setDeck((cur) => (cur ? [{ ...cur[0], draft: d }, ...cur.slice(1)] : cur));
      setRegenOpen(false);
      setRegenNote('');
      toast(`New draft (v${d.version}).`, 'good');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const saveEdit = async () => {
    if (card && dirty) {
      try {
        const d = await patch<ReviewCard['draft']>(`/api/drafts/${card.draft.id}`, draftEdit);
        setDeck((cur) => (cur ? [{ ...cur[0], draft: d }, ...cur.slice(1)] : cur));
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    }
    setEditing(false);
  };

  // Keyboard: → approve · ← skip · E edit · R regenerate · D discard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]');
      if (e.key === 'Escape') {
        if (regenOpen) setRegenOpen(false);
        else if (editing) saveEdit();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') (e.preventDefault(), approve());
      else if (e.key === 'ArrowLeft') (e.preventDefault(), skip());
      else if (e.key.toLowerCase() === 'e') (e.preventDefault(), setEditing(true), setTimeout(() => subjectRef.current?.focus(), 30));
      else if (e.key.toLowerCase() === 'r') (e.preventDefault(), setRegenOpen(true), setTimeout(() => regenRef.current?.focus(), 30));
      else if (e.key.toLowerCase() === 'd') (e.preventDefault(), discard());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const variants = useMemo(
    () => ({
      initial: { opacity: 0, y: 24, scale: 0.99 },
      animate: { opacity: 1, y: 0, x: 0, scale: 1 },
      exit: (k: Exit) => (k === 'approve' ? { opacity: 0, x: 140, rotate: 1.5 } : k === 'skip' ? { opacity: 0, x: -140, rotate: -1.5 } : { opacity: 0, y: 40 }),
    }),
    [],
  );

  if (!deck) return <div className="h-[60vh]" />;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <TwoTone a="Review" b={deck.length ? `${deck.length} waiting` : 'all clear'} className="text-[40px] md:text-[56px]" />
        <div className="w-full max-w-[360px]">
          <div className="mb-1.5 flex justify-between text-[13px] text-ink-3">
            <span>
              {reviewed} of {total} reviewed
            </span>
            <span>{mode === 'gmail_web' ? 'You press Send in Gmail for each one' : 'Nothing sends without your approval'}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={reviewed} aria-label="Review progress">
            <div className="h-full bg-forest transition-[width] duration-300" style={{ width: total ? `${(reviewed / total) * 100}%` : '0%' }} />
          </div>
        </div>
      </div>

      {handedOff && (
        <div className="flex flex-wrap items-center gap-3 rounded-[6px] bg-forest px-4 py-3 text-[14px] text-cream" role="status">
          <span className="min-w-0 flex-1">
            {handedOff.opened ? 'Email to ' : 'Gmail did not open for '}
            <strong className="font-medium">{handedOff.to}</strong>
            {handedOff.opened ? ' is open in Gmail. Press Send there.' : '.'}
          </span>
          <a href={handedOff.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-[4px] bg-cream px-3 text-[13px] font-medium text-ink hover:bg-white">
            {handedOff.opened ? "Didn't open? Open it" : 'Open it in Gmail'}
          </a>
          <button aria-label="Dismiss" className="grid size-9 place-items-center rounded-[4px] text-cream/70 hover:bg-white/10" onClick={() => setHandedOff(null)}>
            ×
          </button>
        </div>
      )}

      {!card ? (
        <Empty title="Nothing to review right now" action={<Button onClick={() => go('targets')}>Add targets</Button>}>
          New drafts appear here as Claude finishes research.{' '}
          {mode === 'gmail_web' ? 'Each one you approve opens in Gmail for you to send.' : 'Approved emails go out slowly, 2–6 minutes apart.'}
        </Empty>
      ) : (
        <AnimatePresence mode="wait" custom={exit}>
          <motion.div key={card.draft.id} custom={exit} variants={variants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }} className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            {/* Draft */}
            <article className="paper-card flex min-h-[560px] flex-col p-5 md:p-7" aria-label="Draft email">
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
                <Badge>{KIND_LABEL[card.draft.kind]}</Badge>
                {card.draft.version > 1 && <Badge>v{card.draft.version}</Badge>}
                <span className="ml-auto truncate">
                  {card.target?.route === 'form_only' && card.draft.kind !== 'intro_request' ? (
                    <>Paste into their form</>
                  ) : (
                    <>
                      To <span className="text-ink">{card.to ?? 'no email'}</span>
                    </>
                  )}
                </span>
              </div>
              {editing ? (
                <div className="mt-5 flex flex-1 flex-col gap-3">
                  <label htmlFor="subj" className="sr-only">
                    Subject
                  </label>
                  <Input id="subj" ref={subjectRef} value={draftEdit?.subject ?? ''} onChange={(e) => setDraftEdit((d) => d && { ...d, subject: e.target.value })} className="text-[18px] font-medium" />
                  <label htmlFor="body" className="sr-only">
                    Body
                  </label>
                  <TextArea id="body" value={draftEdit?.body ?? ''} onChange={(e) => setDraftEdit((d) => d && { ...d, body: e.target.value })} className="min-h-[340px] flex-1 text-[16px]" />
                  <div className="flex items-center justify-between text-[13px] text-ink-3">
                    <span className={cx(words(draftEdit?.body ?? '') >= 150 && 'text-alarm')}>{words(draftEdit?.body ?? '')} / 150 words</span>
                    <Button size="sm" variant="dark" onClick={saveEdit}>
                      Done <Kbd>Esc</Kbd>
                    </Button>
                  </div>
                </div>
              ) : (
                <button className="group mt-5 flex flex-1 flex-col rounded-[4px] text-left focus-visible:outline-offset-4" onClick={() => (setEditing(true), setTimeout(() => subjectRef.current?.focus(), 30))} aria-label="Edit draft">
                  <h2 className="text-[22px] font-medium leading-snug tracking-[-0.02em] md:text-[26px]">{draftEdit?.subject}</h2>
                  <div className="mt-5 whitespace-pre-wrap text-[16px] leading-[1.7] text-ink-2">{highlight(draftEdit?.body ?? '', card.draft.unique_reference)}</div>
                  <span className="mt-auto flex items-center gap-1.5 pt-6 text-[13px] text-ink-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    <Pencil className="size-3.5" /> Click or press E to edit
                  </span>
                </button>
              )}

              <AnimatePresence>
                {regenOpen && (
                  <motion.form initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} onSubmit={(e) => (e.preventDefault(), regenerate())} className="overflow-hidden">
                    <div className="mt-4 flex gap-2">
                      <label htmlFor="regen" className="sr-only">
                        Note for the rewrite
                      </label>
                      <Input id="regen" ref={regenRef} placeholder='Optional note, e.g. "shorter" or "more confident"' value={regenNote} onChange={(e) => setRegenNote(e.target.value)} />
                      <Button type="submit" variant="dark" busy={busy === 'regen'}>
                        Rewrite
                      </Button>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>

              <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-5">
                <Button variant="light" onClick={skip} icon={<ArrowLeft className="size-4" />}>
                  Skip
                </Button>
                <Button variant="ghost" onClick={() => (setRegenOpen((o) => !o), setTimeout(() => regenRef.current?.focus(), 30))} icon={<RefreshCw className="size-4" />}>
                  Regenerate <Kbd>R</Kbd>
                </Button>
                <Button variant="ghost" onClick={discard} busy={busy === 'discard'} icon={<Trash2 className="size-4" />}>
                  Discard <Kbd>D</Kbd>
                </Button>
                <Button className="ml-auto" size="lg" onClick={approve} busy={busy === 'approve'} disabled={!card.to && !(card.target?.route === 'form_only' && card.draft.kind !== 'intro_request')}>
                  {card.target?.route === 'form_only' && card.draft.kind !== 'intro_request' ? (
                    <>
                      <Copy className="size-4" /> Copy &amp; open form
                    </>
                  ) : mode === 'gmail_web' ? (
                    'Open in Gmail'
                  ) : (
                    'Approve'
                  )}
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </article>

            {/* Context */}
            <Context card={card} />
          </motion.div>
        </AnimatePresence>
      )}

      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-ink-3" aria-label="Keyboard shortcuts">
        <span className="flex items-center gap-1.5"><Kbd>→</Kbd> approve</span>
        <span className="flex items-center gap-1.5"><Kbd>←</Kbd> skip</span>
        <span className="flex items-center gap-1.5"><Kbd>E</Kbd> edit</span>
        <span className="flex items-center gap-1.5"><Kbd>R</Kbd> regenerate</span>
        <span className="flex items-center gap-1.5"><Kbd>D</Kbd> discard</span>
      </div>
    </div>
  );
}

function highlight(body: string, ref: string) {
  if (!ref) return body;
  const i = body.toLowerCase().indexOf(ref.toLowerCase());
  if (i < 0) return body;
  return (
    <>
      {body.slice(0, i)}
      <mark className="rounded-[2px] bg-ember/15 px-0.5 text-ink" title="The detail unique to this recipient">
        {body.slice(i, i + ref.length)}
      </mark>
      {body.slice(i + ref.length)}
    </>
  );
}

const CONF = { low: 1, medium: 2, high: 3 } as const;

function Context({ card }: { card: ReviewCard }) {
  const t = card.target;
  const b = card.brief;
  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch {
      return u;
    }
  };
  return (
    <aside className="dark-card on-dark scroll-thin flex max-h-[calc(100dvh-220px)] min-h-[560px] flex-col overflow-y-auto p-5 md:p-7" aria-label="Context">
      <div className="flex items-start gap-3">
        <Monogram name={t?.name ?? '?'} domain={t?.domain} size={48} dark />
        <div className="min-w-0 flex-1">
          <p className="headline text-[28px]">{t?.name ?? "Unknown"}</p>
          <p className="mt-0.5 text-[13px] text-cream/70">
            <span className="capitalize">{t?.kind}</span> {t?.domain ? `· ${t.domain}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {t?.referrer_name && <Badge tone="warm">Warm · {t.referrer_name}</Badge>}
          {t?.route === 'form_only' && <Badge tone="form">Form only</Badge>}
        </div>
      </div>

      {card.draft.kind === 'intro_request' && card.person && (
        <div className="mt-5 rounded-[4px] bg-white/5 p-4">
          <p className="flex items-center gap-2 text-[13px] text-cream/70">
            <Users className="size-4" /> Asking {card.person.name} for an intro
          </p>
          <p className="mt-1 text-[14px]">{card.person.relationship || 'No relationship noted'}</p>
          {card.person.notes && <p className="mt-1 text-[13px] text-cream/70">{card.person.notes}</p>}
        </div>
      )}

      {b ? (
        <div className="mt-6 grid gap-6 text-[14px]">
          <div>
            <p className="text-[13px] text-cream/70">What they do</p>
            <p className="mt-1 leading-relaxed">{b.summary}</p>
            <p className="mt-2 leading-relaxed text-cream/80">{b.aesthetic}</p>
          </div>

          <div>
            <p className="text-[13px] text-cream/70">Favourites to look for</p>
            <ul className="mt-2 grid gap-2">
              {b.favourites.map((f) => (
                <li key={f.title} className="rounded-[4px] bg-white/5 px-3 py-2.5">
                  <p className="font-medium">
                    {f.url ? (
                      <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-cream/30 underline-offset-2 hover:decoration-cream">
                        {f.title} <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      f.title
                    )}
                  </p>
                  <p className="mt-0.5 text-[13px] text-cream/70">{f.why}</p>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[13px] text-cream/70">Possible deal</p>
            <ul className="mt-2 grid gap-2">
              {b.possible_deals.map((d) => (
                <li key={d.type} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
                  <span className="capitalize">{d.type}</span>
                  <span className="flex items-center gap-1" aria-label={`${d.confidence} confidence`}>
                    {[1, 2, 3].map((n) => (
                      <span key={n} className={cx('h-1.5 w-5 rounded-full', n <= CONF[d.confidence] ? (d.confidence === 'high' ? 'bg-leaf' : 'bg-cream/80') : 'bg-white/15')} />
                    ))}
                    <span className="ml-1 w-14 text-right text-[12px] text-cream/70">{d.confidence}</span>
                  </span>
                  <span className="col-span-2 text-[13px] text-cream/70">{d.reason}</span>
                </li>
              ))}
            </ul>
          </div>

          {b.recent.length > 0 && (
            <div>
              <p className="text-[13px] text-cream/70">Recent</p>
              <ul className="mt-1 list-disc pl-4 leading-relaxed text-cream/90">
                {b.recent.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="text-[13px] text-cream/70">How they take pitches</p>
            <p className="mt-1 leading-relaxed">{b.submission_rules}</p>
          </div>

          {b.red_flags.length > 0 && (
            <div className="rounded-[4px] bg-alarm/20 p-3">
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-[#ffb4b4]">
                <AlertTriangle className="size-4" /> Red flags
              </p>
              <ul className="mt-1 list-disc pl-4 text-[13px]">
                {b.red_flags.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-x-3 gap-y-1.5 border-t border-white/10 pt-4">
            {b.sources.map((s) => (
              <a key={s} href={s} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-cream/70 hover:text-cream">
                <Link2 className="size-3" /> {host(s)}
              </a>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-6 text-[14px] text-cream/70">No research brief for this one.</p>
      )}
    </aside>
  );
}
