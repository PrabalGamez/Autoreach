import { motion } from 'framer-motion';
import { Clock, Undo2 } from 'lucide-react';
import type { Target, TargetStatus } from '../../../shared/types.ts';
import { PIPELINE_STATUSES } from '../../../shared/types.ts';
import { Badge, Button, Monogram, Select, TwoTone, cx, useToast } from '../components/ui.tsx';
import { patch, post, useApi } from '../lib/api.ts';
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

export function Pipeline() {
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
      <TwoTone a="Pipeline" b={`${total} targets`} className="text-[40px] md:text-[56px]" />

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
