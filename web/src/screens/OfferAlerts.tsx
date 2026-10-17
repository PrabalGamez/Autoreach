import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ExternalLink, Flame, PenLine, Scale } from 'lucide-react';
import type { OfferAlert } from '../../../shared/types.ts';
import { Button, useToast } from '../components/ui.tsx';
import { Circuit } from '../components/Circuit.tsx';
import { post, useApi } from '../lib/api.ts';
import type { Route } from '../components/Shell.tsx';

/** Full-screen, blocking. Stays until every pending offer is acknowledged. */
export function OfferAlerts({ onChange, go, sender }: { onChange: () => void; go: (r: Route) => void; sender: string | null }) {
  const alerts = useApi<{ pending: OfferAlert[]; notice: string }>('/api/alerts', 5000);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const first = useRef<HTMLButtonElement>(null);
  const pending = alerts.data?.pending ?? [];
  const a = pending[0];

  useEffect(() => {
    first.current?.focus();
  }, [a?.id]);
  // Trap focus inside the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const root = document.getElementById('offer-dialog');
      const f = root?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
      if (!f?.length) return;
      const [firstEl, lastEl] = [f[0], f[f.length - 1]];
      if (e.shiftKey && document.activeElement === firstEl) (e.preventDefault(), lastEl.focus());
      else if (!e.shiftKey && document.activeElement === lastEl) (e.preventDefault(), firstEl.focus());
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (!a) return null;
  const act = async (k: 'ack' | 'handled' | 'draft') => {
    setBusy(k);
    try {
      if (k === 'draft') {
        await post(`/api/alerts/${a.id}/draft-reply`);
        toast('Reply drafted. It is waiting in Review.', 'good');
        go('review');
      } else await post(`/api/alerts/${a.id}/${k}`);
      await alerts.reload();
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  const t = a.terms;
  const terms = [
    ['Money', t?.money],
    ['Rights', t?.rights],
    ['Term length', t?.term_length],
    ['Exclusivity', t?.exclusivity],
  ] as const;

  return (
    <div id="offer-dialog" role="alertdialog" aria-modal="true" aria-labelledby="offer-title" aria-describedby="offer-summary" className="fixed inset-0 z-[60] overflow-y-auto bg-forest-2 text-cream">
      <Circuit dark />
      <motion.div key={a.id} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }} className="relative mx-auto max-w-[980px] px-4 py-10 md:px-6 md:py-16">
        <div className="flex flex-wrap items-center gap-3">
          <motion.span initial={{ scale: 0.6 }} animate={{ scale: [0.6, 1.15, 1] }} transition={{ duration: 0.6 }} className="grid size-11 place-items-center rounded-[6px] bg-ember text-white">
            <Flame className="size-5" aria-hidden />
          </motion.span>
          <span className="rounded-[4px] bg-white/10 px-3 py-1.5 text-[13px]">
            Offer {pending.length > 1 ? `1 of ${pending.length}` : 'received'} · {a.received_at ? new Date(a.received_at).toLocaleString() : ''}
          </span>
          {a.confidence != null && <span className="text-[13px] text-cream/70">Claude is {Math.round(a.confidence * 100)}% sure this is an offer</span>}
        </div>

        <h1 id="offer-title" className="display mt-8 text-[44px] md:text-[80px]">
          {a.target_name ?? a.from_email}
          <br />
          <span className="text-cream/50">sent you an offer.</span>
        </h1>
        <p id="offer-summary" className="mt-6 max-w-[680px] text-[18px] leading-relaxed text-cream/90">
          {a.summary}
        </p>

        <dl className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {terms.map(([k, v]) => (
            <div key={k} className="rounded-[6px] bg-forest p-4 shadow-[var(--shadow-dark)]">
              <dt className="text-[13px] text-cream/70">{k}</dt>
              <dd className="mt-2 text-[17px] leading-snug">{v ?? <span className="text-cream/50">Not stated</span>}</dd>
            </div>
          ))}
        </dl>
        {t?.other?.length ? <p className="mt-3 text-[14px] text-cream/80">Also: {t.other.join(' · ')}</p> : null}

        {a.questions.length > 0 && (
          <div className="mt-8 rounded-[6px] bg-cream p-5 text-ink md:p-6">
            <p className="text-[15px] font-medium">Worth questioning before you agree</p>
            <ul className="mt-3 grid gap-2 text-[15px]">
              {a.questions.map((q) => (
                <li key={q} className="flex gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-ember" />
                  {q}
                </li>
              ))}
            </ul>
          </div>
        )}

        <details className="mt-6 rounded-[6px] bg-white/5 p-4">
          <summary className="text-[14px] text-cream/80">Their email</summary>
          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-cream/90">{a.body}</pre>
        </details>

        <p className="mt-6 flex items-start gap-2 text-[14px] text-cream/70">
          <Scale className="mt-0.5 size-4 shrink-0" aria-hidden /> {alerts.data?.notice}
        </p>

        <div className="mt-8 flex flex-wrap gap-2">
          <a
            href={
              a.thread_id.startsWith('manual-')
                ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(sender ?? '')}#search/${encodeURIComponent(`from:${a.from_email ?? ''}`)}`
                : `https://mail.google.com/mail/?authuser=${encodeURIComponent(sender ?? '')}#all/${a.thread_id}`
            } target="_blank" rel="noreferrer" className="inline-flex h-12 items-center gap-2 rounded-[4px] bg-cream px-5 text-[15px] font-medium text-ink transition-colors duration-150 hover:bg-white">
            <ExternalLink className="size-4" /> Open thread
          </a>
          <Button ref={first} size="lg" variant="ember" busy={busy === 'draft'} icon={<PenLine className="size-4" />} onClick={() => act('draft')}>
            Draft reply
          </Button>
          <Button size="lg" variant="subtle" busy={busy === 'handled'} icon={<Check className="size-4" />} onClick={() => act('handled')}>
            Mark handled
          </Button>
          <Button size="lg" variant="onDark" busy={busy === 'ack'} onClick={() => act('ack')}>
            Acknowledge for now
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
