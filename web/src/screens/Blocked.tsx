import { useState } from 'react';
import { Check, Copy, Terminal, XCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import type { Health } from '../../../shared/types.ts';
import { Button, LogoPill, cx } from '../components/ui.tsx';
import { Circuit } from '../components/Circuit.tsx';
import { post } from '../lib/api.ts';

function Cmd({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex items-center gap-2 rounded-[4px] bg-forest-2 py-1.5 pl-3 pr-1.5 text-cream">
      <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{cmd}</code>
      <button
        aria-label={`Copy ${cmd}`}
        className="grid size-9 place-items-center rounded-[3px] text-cream/70 hover:bg-white/10 hover:text-cream"
        onClick={() => navigator.clipboard.writeText(cmd).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

export function Blocked({ health, onRecheck }: { health: Health; onRecheck: () => void }) {
  const c = health.claude;
  const [busy, setBusy] = useState(false);
  const installed = Boolean(c?.installed);
  const recheck = async () => {
    setBusy(true);
    try {
      await post('/api/health/recheck');
    } finally {
      setBusy(false);
      onRecheck();
    }
  };

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <Circuit />
      <div className="relative mx-auto flex max-w-[1100px] flex-col px-4 pb-16 pt-5 md:px-6">
        <LogoPill />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }} className="mx-auto mt-16 max-w-[820px] text-center md:mt-24">
          <span className="inline-flex items-center gap-2 rounded-[4px] bg-paper px-3 py-1.5 text-[13px] text-ink-2 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
            <XCircle className="size-4 text-alarm" aria-hidden />
            {installed ? `Claude Code ${c?.version ?? ''} found, not signed in` : 'Claude Code not found'}
          </span>
          <h1 className="display mt-6 text-[44px] sm:text-[64px] md:text-[84px]">
            <span className="text-ink">Autoreach runs on</span>
            <br />
            <span className="text-hush">your</span> <span className="text-ink">Claude Code.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-[520px] text-[16px] text-ink-3">
            Research, drafting and reply checks all go through the Claude Code on this Mac, with your own login and plan. Nothing runs until it is ready.
          </p>
        </motion.div>

        <div className="mx-auto mt-12 grid w-full max-w-[880px] gap-4 md:grid-cols-2">
          {[
            { done: installed, title: 'Install Claude Code', body: 'Skip this if `claude --version` already works in Terminal.', cmd: 'npm install -g @anthropic-ai/claude-code' },
            { done: Boolean(c?.loggedIn), title: 'Sign in once in Terminal', body: 'Run it, then type /login and finish the browser sign-in. The desktop app login does not cover the terminal.', cmd: 'claude' },
          ].map((s, i) => (
            <motion.div key={s.title} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.08, duration: 0.4 }} className="dark-card p-5">
              <div className="flex items-center gap-3">
                <span className={cx('grid size-8 place-items-center rounded-[4px]', s.done ? 'bg-leaf text-white' : 'bg-white/10 text-cream')}>{s.done ? <Check className="size-4" /> : <Terminal className="size-4" />}</span>
                <p className="text-[16px] font-medium">{s.title}</p>
              </div>
              <p className="mt-3 text-[14px] text-cream/70">{s.body}</p>
              <Cmd cmd={s.cmd} />
            </motion.div>
          ))}
        </div>

        <div className="mt-8 flex flex-col items-center gap-3">
          <Button size="lg" onClick={recheck} busy={busy}>
            Check again
          </Button>
          {c?.error && <p className="max-w-[640px] text-center font-mono text-[12px] text-ink-3">Last error: {c.error}</p>}
        </div>
      </div>
    </div>
  );
}

export function SessionMissing() {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4">
      <Circuit />
      <div className="relative max-w-[560px] text-center">
        <h1 className="display text-[44px] md:text-[64px]">
          <span>Open Autoreach</span> <span className="text-hush">from Claude Code.</span>
        </h1>
        <p className="mt-4 text-ink-3">
          For safety this page only works from the link the launcher opens. Run <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-[14px]">/autoreach</code> in Claude Code.
        </p>
      </div>
    </div>
  );
}
