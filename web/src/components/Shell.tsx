import type { ReactNode } from 'react';
import { useState } from 'react';
import { AlertTriangle, Menu, X, Send, Clock } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Health } from '../../../shared/types.ts';
import { Button, LogoPill, cx, useToast } from './ui.tsx';
import { post } from '../lib/api.ts';

export type Route = 'review' | 'targets' | 'pipeline' | 'referrals' | 'dashboard' | 'settings';
const NAV: { id: Route; label: string }[] = [
  { id: 'review', label: 'Review' },
  { id: 'targets', label: 'Targets' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'referrals', label: 'Referrals' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'settings', label: 'Settings' },
];

export function Shell({ route, go, health, onHealth, children }: { route: Route; go: (r: Route) => void; health: Health; onHealth: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const [resuming, setResuming] = useState(false);

  const resume = async () => {
    setResuming(true);
    try {
      await post('/api/system/resume');
      toast('Resumed. Sending and reply checks are back on.', 'good');
      onHealth();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className="min-h-dvh">
      {health.paused.paused && (
        <div role="alert" className="sticky top-0 z-40 flex flex-wrap items-center gap-3 bg-alarm px-4 py-3 text-[14px] text-white md:px-6">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">
            <strong className="font-semibold">Everything is paused.</strong> {health.paused.reason}
          </p>
          <Button size="sm" variant="light" onClick={resume} busy={resuming}>
            Check and resume
          </Button>
        </div>
      )}

      <header className="on-dark sticky top-0 z-30 bg-forest-2 text-cream shadow-[0_1px_0_rgba(255,255,255,0.06),0_8px_24px_-12px_rgba(0,0,0,0.5)]" style={health.paused.paused ? { top: 48 } : undefined}>
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 md:px-6">
          <LogoPill onClick={() => go('review')} />
          <nav aria-label="Main" className="ml-3 hidden items-center gap-1 rounded-[8px] bg-white/[0.06] p-1 lg:flex">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                aria-current={route === n.id ? 'page' : undefined}
                className={cx('relative h-9 rounded-[6px] px-3.5 text-[14px] font-medium transition-colors duration-150', route === n.id ? 'text-forest-2' : 'text-cream/75 hover:text-cream')}
              >
                {route === n.id && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-[6px] bg-lime" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                <span className="relative">{n.label}</span>
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <QueueChip health={health} />
            <button className="grid size-11 place-items-center rounded-[6px] bg-lime text-forest-2 lg:hidden" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </div>
        <AnimatePresence>
          {open && (
            <motion.nav initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} aria-label="Main" className="mx-4 mb-3 grid gap-1 rounded-[8px] bg-white/[0.06] p-2 lg:hidden">
              {NAV.map((n) => (
                <button key={n.id} onClick={() => (go(n.id), setOpen(false))} className={cx('h-11 rounded-[6px] px-3 text-left text-[15px] font-medium', route === n.id ? 'bg-lime text-forest-2' : 'text-cream/80 hover:bg-white/10')}>
                  {n.label}
                </button>
              ))}
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 pb-24 pt-6 md:px-6 md:pt-10">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={route} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}>
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function QueueChip({ health }: { health: Health }) {
  const q = health.queue;
  const working = health.jobs.running + health.jobs.waiting;
  return (
    <div className="hidden items-center gap-2 sm:flex">
      {working > 0 && (
        <span className="flex h-9 items-center gap-2 rounded-[6px] bg-white/[0.08] px-3 text-[13px] text-cream/85">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-lime opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex size-2 rounded-full bg-lime" />
          </span>
          Claude working · {working}
        </span>
      )}
      <span className="flex h-9 items-center gap-2 rounded-[6px] bg-white/[0.08] px-3 text-[13px] text-cream/85" title="Sent today / daily cap">
        <Send className="size-3.5" aria-hidden />
        {q.sentToday}/{q.cap} today
        {q.queued > 0 && (
          <>
            <span className="text-cream/40">·</span>
            <Clock className="size-3.5" aria-hidden /> {q.queued} queued
          </>
        )}
      </span>
      {health.fakeGmail && <span className="flex h-9 items-center rounded-[4px] bg-sun px-3 text-[13px] font-medium text-[#3d3005]">Demo mailbox</span>}
    </div>
  );
}
