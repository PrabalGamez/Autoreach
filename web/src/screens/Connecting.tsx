import { motion } from 'framer-motion';
import { Check, Loader2 } from 'lucide-react';
import type { Health } from '../../../shared/types.ts';
import { LogoPill, Mark, cx } from '../components/ui.tsx';
import { Circuit } from '../components/Circuit.tsx';

type StepState = 'done' | 'active' | 'pending';

/** Shown while the app checks for Claude Code (boot, or "Check again"). */
export function Connecting({ health }: { health: Health | null }) {
  const stage = health?.claudeCheck.stage ?? 'finding';
  const steps: { label: string; detail: string; state: StepState }[] = [
    {
      label: 'Finding Claude Code on this Mac',
      detail: stage === 'signing_in' ? `Found Claude Code ${health?.claudeCheck.version ?? ''}`.trim() : 'Looking for the claude command',
      state: stage === 'finding' ? 'active' : 'done',
    },
    { label: 'Checking you are signed in', detail: 'A tiny test request with your own login', state: stage === 'signing_in' ? 'active' : 'pending' },
    { label: 'Opening Autoreach', detail: 'Your targets, drafts and replies', state: 'pending' },
  ];

  return (
    <div className="relative min-h-dvh overflow-hidden" role="status" aria-live="polite" aria-label="Connecting to Claude Code">
      <Circuit />
      <div className="relative mx-auto flex min-h-dvh max-w-[1100px] flex-col px-4 pb-16 pt-5 md:px-6">
        <LogoPill />
        <div className="m-auto flex w-full flex-col items-center pt-10 text-center">
          <div className="relative grid size-24 place-items-center">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="absolute inset-0 rounded-[18px] border border-moss/40"
                initial={{ opacity: 0.6, scale: 0.6 }}
                animate={{ opacity: 0, scale: 1.5 }}
                transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: 'easeOut' }}
              />
            ))}
            <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}>
              <Mark size={56} className="rounded-[10px] shadow-[var(--shadow-dark)]" />
            </motion.div>
          </div>

          <h1 className="display mt-10 text-[44px] sm:text-[64px] md:text-[80px]">
            <span className="text-hush">Connecting to</span>
            <br />
            <span className="text-ink">Claude Code.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-[460px] text-[16px] text-ink-3">Autoreach does its research and writing through the Claude Code on this Mac, signed in as you.</p>

          <ol className="mt-10 grid w-full max-w-[440px] gap-2 text-left">
            {steps.map((s, i) => (
              <motion.li
                key={s.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.08 }}
                className={cx(
                  'flex items-center gap-3 rounded-[6px] px-4 py-3 transition-colors duration-300',
                  s.state === 'active' ? 'bg-forest text-cream shadow-[var(--shadow-dark)]' : 'bg-paper shadow-[0_0_0_1px_rgba(0,0,0,0.06)]',
                  s.state === 'pending' && 'opacity-60',
                )}
              >
                <span className={cx('grid size-7 shrink-0 place-items-center rounded-[4px]', s.state === 'done' ? 'bg-leaf text-white' : s.state === 'active' ? 'bg-white/10' : 'bg-black/5 text-ink-3')}>
                  {s.state === 'done' ? <Check className="size-4" /> : s.state === 'active' ? <Loader2 className="size-4 animate-spin" /> : <span className="text-[12px]">{i + 1}</span>}
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium">{s.label}</span>
                  <span className={cx('block text-[13px]', s.state === 'active' ? 'text-cream/70' : 'text-ink-3')}>{s.detail}</span>
                </span>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
