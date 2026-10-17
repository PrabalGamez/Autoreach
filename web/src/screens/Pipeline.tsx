import { motion } from 'framer-motion';
import { useState } from 'react';
import { Clock, ExternalLink, MessageSquareReply, Undo2 } from 'lucide-react';
import type { Target, TargetStatus } from '../../../shared/types.ts';
import { PIPELINE_STATUSES } from '../../../shared/types.ts';
import { Badge, Button, Monogram, Select, TextArea, TwoTone, cx, useToast } from '../components/ui.tsx';
import { api, patch, post, useApi } from '../lib/api.ts';
import { STATUS_LABEL } from './Targets.tsx';

interface QueueRow {
  draft_id: number;
  subject: string;
  kind: string;
  target_name: string | null;
  person_name: string | null;
  attempts: number;
  last_error: string | null;
}

export function Pipeline({ mode }: { mode: 'gmail_web' | 'gmail_api' }) {
  const board = useApi<{ status: TargetStatus; targets: Target[] }[]>('/api/pipeline', 5000);
  const queue = useApi<QueueRow[]>('/api/queue', 5000);
  const toast = useToast();
  const total = board.data?.reduce((n, c) => n + c.targets.length, 0) ?? 0;

  const move = async (t: Target, status: TargetStatus) => {
    try {
      await patch(`/api/targets/${t.id}`, { status });
      board.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const pull = async (id: number) => {
    try {
      await post(`/api/drafts/${id}/unqueue`);
      toast('Pulled back to Review.', 'good');
      queue.reload();
      board.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <TwoTone a="Pipeline" b={`${total} targets`} className="text-[40px] md:text-[56px]" />
        {mode === 'gmail_web' && (
          <Button
            variant="dark"
            icon={<ExternalLink className="size-4" />}
            onClick={async () => {
              const w = window.open('about:blank', '_blank');
              try {
                const r = await api<{ url: string; count: number }>('/api/gmail/replies-search');
                if (w) (w.opener = null), (w.location.href = r.url);
              } catch (e) {
                w?.close();
                toast((e as Error).message, 'error');
              }
            }}
          >
            Check Gmail for replies
          </Button>
        )}
      </div>
      {mode === 'gmail_web' && <p className="-mt-3 text-[14px] text-ink-3">Got a reply? Press "Log reply" on that target and paste it. Claude reads it, flags offers, and honours opt-outs.</p>}

      {(queue.data?.length ?? 0) > 0 && (
        <section className="dark-card on-dark p-5" aria-label="Send queue">
          <p className="flex items-center gap-2 text-[15px] font-medium">
            <Clock className="size-4" /> Send queue <span className="text-cream/60">· goes out 2–6 minutes apart, inside send windows</span>
          </p>
          <ul className="mt-3 grid gap-2">
            {queue.data!.map((q) => (
              <li key={q.draft_id} className="flex flex-wrap items-center gap-3 rounded-[4px] bg-white/5 px-3 py-2 text-[14px]">
                <span className="font-medium">{q.person_name ? `${q.person_name} → intro to ${q.target_name}` : q.target_name}</span>
                <span className="min-w-0 flex-1 truncate text-cream/70">{q.subject}</span>
                {q.last_error && <span className="text-[12px] text-[#ffb4b4]">retrying: {q.last_error.slice(0, 80)}</span>}
                <Button size="sm" variant="onDark" icon={<Undo2 className="size-3.5" />} onClick={() => pull(q.draft_id)}>
                  Pull back
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="scroll-thin -mx-4 overflow-x-auto px-4 pb-4 md:-mx-6 md:px-6">
        <div className="grid min-w-max auto-cols-[270px] grid-flow-col gap-3">
          {(board.data ?? PIPELINE_STATUSES.map((s) => ({ status: s, targets: [] as Target[] }))).map((col) => (
            <section key={col.status} aria-label={STATUS_LABEL[col.status]} className={cx('flex min-h-[420px] flex-col rounded-[6px] p-2', col.status === 'offer' ? 'bg-ember/10 shadow-[inset_0_0_0_1px_#f2652255]' : 'bg-ground-2 shadow-[inset_0_0_0_1px_var(--color-line)]')}>
              <header className="flex items-center justify-between px-2 py-2">
                <h2 className="text-[14px] font-medium">{STATUS_LABEL[col.status]}</h2>
                <span className="text-[13px] text-ink-3">{col.targets.length}</span>
              </header>
              <ul className="grid gap-2">
                {col.targets.map((t, i) => (
                  <motion.li key={t.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.03 }} className="paper-card p-3">
                    <div className="flex items-center gap-2.5">
                      <Monogram name={t.name} domain={t.domain} size={30} />
                      <p className="min-w-0 flex-1 truncate text-[14px] font-medium">{t.name}</p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.referrer_name && <Badge tone="warm">Warm</Badge>}
                      {t.route === 'form_only' && <Badge tone="form">Form</Badge>}
                      {t.suppressed && <Badge tone="bad">Opted out</Badge>}
                      <Badge>{t.kind}</Badge>
                    </div>
                    <label className="sr-only" htmlFor={`mv-${t.id}`}>
                      Move {t.name}
                    </label>
                    {['sent', 'replied', 'offer'].includes(t.status) && <LogReply target={t} onDone={board.reload} />}
                    <Select id={`mv-${t.id}`} value={t.status} onChange={(e) => move(t, e.target.value as TargetStatus)} className="mt-2 h-9 py-1 text-[13px]">
                      {PIPELINE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </Select>
                  </motion.li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

const LABEL: Record<string, string> = { offer: 'Offer! Check the alert.', interested: 'Interested', decline: 'Declined', auto_reply: 'Auto-reply', other: 'Reply logged', opt_out: 'Opted out. They will never be contacted again.' };

/** Paste a reply from Gmail; Claude classifies it. */
function LogReply({ target, onDone }: { target: Target; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await post<{ label: string; summary: string }>(`/api/targets/${target.id}/reply`, { text });
      toast(`${LABEL[r.label] ?? 'Logged'}${r.summary ? ` ${r.summary}` : ''}`, r.label === 'offer' ? 'good' : 'info');
      setOpen(false);
      setText('');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-[4px] bg-ground-2 text-[13px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-ground">
        <MessageSquareReply className="size-3.5" /> Log reply
      </button>
    );
  return (
    <div className="mt-2 grid gap-2">
      <label htmlFor={`reply-${target.id}`} className="sr-only">
        Paste {target.name}'s reply
      </label>
      <TextArea id={`reply-${target.id}`} rows={4} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste their reply" className="min-h-24 text-[13px]" />
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} busy={busy} disabled={text.trim().length < 2}>
          Read it
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
