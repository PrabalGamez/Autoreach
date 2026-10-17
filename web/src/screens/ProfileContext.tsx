import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowRight, Check, Globe, RotateCw, Search, Wrench } from 'lucide-react';
import type { ProfileContext as Ctx, ContextJob, Health, Profile } from '../../../shared/types.ts';
import { Button, Input, LogoPill, cx, useToast } from '../components/ui.tsx';
import { Circuit } from '../components/Circuit.tsx';
import { api, post, useApi } from '../lib/api.ts';

const host = (u: string) => {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, '')}${x.pathname === '/' ? '' : x.pathname}`;
  } catch {
    return u;
  }
};

function useElapsed(since: string | null, running: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  if (!since) return '0:00';
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Runs once after Claude Code is connected and the profile is complete.
 * Skipped entirely when the context already exists (health.hasContext, the "ifContext" switch).
 */
export function ProfileContextScreen({ health, onHealth, onContinue }: { health: Health; onHealth: () => void; onContinue: () => void }) {
  const toast = useToast();
  const profile = useApi<Profile>('/api/profile');
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [note, setNote] = useState('');
  const [redo, setRedo] = useState(false);
  const started = useRef(false);
  const job: ContextJob = health.contextJob;
  const running = job.status === 'running';
  const elapsed = useElapsed(job.startedAt, running);
  const alias = profile.data?.alias || 'you';

  const start = async (withNote?: string) => {
    try {
      setCtx(null);
      await post('/api/context/build', withNote ? { note: withNote } : {});
      setRedo(false);
      setNote('');
      onHealth();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  // Kick off once. If a run already finished earlier (context exists), just show the result.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (health.hasContext) return;
    if (job.status === 'idle') void start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (health.hasContext && !running) api<{ context: Ctx }>('/api/context').then((r) => setCtx(r.context));
  }, [health.hasContext, running]);

  const skip = async () => {
    await post('/api/context/skip').catch(() => {});
    onHealth();
    onContinue();
  };

  const searches = job.activity.filter((a) => a.kind === 'search').length;
  const reads = job.activity.filter((a) => a.kind === 'fetch').length;
  const feed = [...job.activity].reverse().slice(0, 7);
  const showResult = Boolean(ctx) && !running && !redo;

  return (
    <div className="satin relative min-h-dvh overflow-hidden text-cream">
      <Circuit dark />
      <div className="relative mx-auto max-w-[1180px] px-4 pb-20 pt-5 md:px-6">
        <LogoPill />

        <AnimatePresence mode="wait">
          {showResult && ctx ? (
            <Result key="result" alias={alias} ctx={ctx} onContinue={onContinue} onRedo={() => setRedo(true)} />
          ) : (
            <motion.div key="loading" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.4 }} className="mt-14 grid gap-10 lg:mt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-16">
              <div role="status" aria-live="polite">
                <p className="text-[14px] text-cream/70">{job.status === 'failed' ? 'Research stopped' : redo ? 'Run it again' : `Claude is researching · ${elapsed}`}</p>
                <h1 className="display mt-3 text-[48px] md:text-[80px]">
                  <span className="text-cream/50">Getting to know</span>
                  <br />
                  <span className="text-cream">{alias}.</span>
                </h1>
                <p className="mt-6 max-w-[520px] text-[17px] leading-relaxed text-cream/80">
                  Claude reads your links and what is public about your work, once. Every pitch after this starts from what is true about you. This usually takes 1–3 minutes.
                </p>

                {running && (
                  <div className="mt-8 max-w-[520px]">
                    <div className="h-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
                      <motion.div className="h-full w-1/3 rounded-full bg-ember" animate={{ x: ['-100%', '300%'] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }} />
                    </div>
                    <dl className="mt-5 grid grid-cols-3 gap-3">
                      {[
                        ['Searches', searches],
                        ['Pages read', reads],
                        ['Elapsed', elapsed],
                      ].map(([k, v]) => (
                        <div key={k} className="rounded-[6px] bg-forest p-4 shadow-[var(--shadow-dark)]">
                          <dt className="text-[13px] text-cream/70">{k}</dt>
                          <dd className="mt-1 text-[28px] leading-none tracking-[-0.03em] tabular-nums">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                {job.status === 'failed' && !redo && (
                  <div className="mt-8 max-w-[520px] rounded-[6px] bg-alarm/20 p-4" role="alert">
                    <p className="flex items-center gap-2 text-[15px] font-medium">
                      <AlertTriangle className="size-4" /> Claude could not finish the research.
                    </p>
                    <p className="mt-1 text-[13px] text-cream/80">{job.error?.slice(0, 240)}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button variant="light" icon={<RotateCw className="size-4" />} onClick={() => start()}>
                        Try again
                      </Button>
                      <Button variant="onDark" onClick={skip}>
                        Skip for now
                      </Button>
                    </div>
                  </div>
                )}

                {redo && (
                  <form className="mt-8 grid max-w-[520px] gap-3" onSubmit={(e) => (e.preventDefault(), start(note))}>
                    <label htmlFor="ctx-note" className="text-[14px] text-cream/80">
                      What should Claude know or fix? (optional)
                    </label>
                    <Input id="ctx-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Someone else shares my name; only use the links I gave" className="border-transparent bg-cream" />
                    <div className="flex gap-2">
                      <Button type="submit" variant="ember" icon={<RotateCw className="size-4" />}>
                        Research again
                      </Button>
                      <Button type="button" variant="onDark" onClick={() => setRedo(false)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}

                {running && (
                  <button onClick={skip} className="mt-8 text-[14px] text-cream/60 underline decoration-cream/30 underline-offset-4 hover:text-cream">
                    Skip for now (research keeps running in the background)
                  </button>
                )}
              </div>

              <section aria-label="What Claude is doing" className="self-start rounded-[10px] bg-forest-2/70 p-5 shadow-[var(--shadow-dark)] md:p-6">
                <p className="text-[14px] font-medium">Live</p>
                <p className="text-[13px] text-cream/60">Every search and page Claude opens, as it happens.</p>
                <ul className="mt-4 grid gap-2">
                  {feed.length === 0 && (
                    <li className="flex items-center gap-3 rounded-[4px] bg-white/5 px-3 py-2.5 text-[14px] text-cream/70">
                      <span className="relative flex size-2">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-ember opacity-60 motion-reduce:hidden" />
                        <span className="relative inline-flex size-2 rounded-full bg-ember" />
                      </span>
                      {running ? 'Starting up…' : 'Waiting to start'}
                    </li>
                  )}
                  <AnimatePresence initial={false}>
                    {feed.map((a, i) => {
                      const Icon = a.kind === 'search' ? Search : a.kind === 'fetch' ? Globe : Wrench;
                      return (
                        <motion.li
                          key={a.at + a.text}
                          layout
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: i === 0 ? 1 : Math.max(0.35, 1 - i * 0.12), y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.25 }}
                          className="flex items-start gap-3 rounded-[4px] bg-white/5 px-3 py-2.5"
                        >
                          <span className={cx('mt-0.5 grid size-6 shrink-0 place-items-center rounded-[3px]', i === 0 && running ? 'bg-ember text-white' : 'bg-white/10')}>
                            <Icon className="size-3.5" aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[12px] text-cream/60">{a.kind === 'search' ? 'Searched' : a.kind === 'fetch' ? 'Read' : 'Used'}</span>
                            <span className="block truncate text-[14px]">{a.kind === 'fetch' ? host(a.text) : a.text}</span>
                          </span>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              </section>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Result({ alias, ctx, onContinue, onRedo }: { alias: string; ctx: Ctx; onContinue: () => void; onRedo: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }} className="mt-14 lg:mt-20">
      <p className="flex items-center gap-2 text-[14px] text-cream/70">
        <span className="grid size-5 place-items-center rounded-[3px] bg-leaf text-white">
          <Check className="size-3" />
        </span>
        Research done
      </p>
      <h1 className="display mt-3 text-[44px] md:text-[72px]">
        <span className="text-cream">Here is {alias},</span>
        <br />
        <span className="text-cream/50">as Claude sees it.</span>
      </h1>
      <p className="mt-6 max-w-[720px] text-[18px] leading-relaxed text-cream/90">{ctx.summary}</p>

      <div className="mt-10 grid gap-3 md:grid-cols-3">
        <div className="rounded-[6px] bg-forest p-5 shadow-[var(--shadow-dark)] md:col-span-2">
          <p className="text-[13px] text-cream/70">Style</p>
          <p className="mt-1 text-[17px] leading-relaxed">{ctx.style}</p>
          {ctx.peers.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {ctx.peers.map((a) => (
                <span key={a} className="rounded-[3px] bg-white/10 px-2 py-1 text-[13px]">
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-[6px] bg-forest p-5 shadow-[var(--shadow-dark)]">
          <p className="text-[13px] text-cream/70">Stage</p>
          <p className="mt-1 text-[28px] capitalize leading-tight tracking-[-0.03em]">{ctx.audience_stage}</p>
          <p className="mt-2 text-[14px] text-cream/80">{ctx.audience_reason}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-[6px] bg-cream p-5 text-ink">
          <p className="text-[15px] font-medium">Facts your pitches can use</p>
          <ul className="mt-3 grid gap-2 text-[15px]">
            {ctx.facts_to_use.map((f) => (
              <li key={f} className="flex gap-2">
                <Check className="mt-1 size-4 shrink-0 text-moss" /> {f}
              </li>
            ))}
            {!ctx.facts_to_use.length && <li className="text-ink-3">Nothing public to cite yet. Pitches will lean on the work itself.</li>}
          </ul>
        </div>
        <div className="rounded-[6px] bg-forest p-5 shadow-[var(--shadow-dark)]">
          <p className="text-[15px] font-medium">Where you fit</p>
          <ul className="mt-3 grid gap-3 text-[14px]">
            {ctx.fit.map((t) => (
              <li key={t.tier}>
                <span className="text-[12px] uppercase tracking-[0.04em] text-cream/60">{t.tier}</span>
                <p className="mt-0.5">{t.examples.join(', ')}</p>
                <p className="text-[13px] text-cream/70">{t.why}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {(ctx.uncertain.length > 0 || ctx.gaps.length > 0) && (
        <div className="mt-3 rounded-[6px] bg-white/5 p-5">
          {ctx.uncertain.length > 0 && (
            <>
              <p className="flex items-center gap-2 text-[15px] font-medium text-sun">
                <AlertTriangle className="size-4" /> Check these
              </p>
              <ul className="mt-2 list-disc pl-5 text-[14px] text-cream/85">
                {ctx.uncertain.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </>
          )}
          {ctx.gaps.length > 0 && (
            <>
              <p className="mt-4 text-[15px] font-medium">What they may see as missing</p>
              <ul className="mt-2 list-disc pl-5 text-[14px] text-cream/85">
                {ctx.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="mt-8 flex flex-wrap gap-2">
        <Button size="lg" variant="light" onClick={onContinue}>
          Looks right, continue <ArrowRight className="size-4" />
        </Button>
        <Button size="lg" variant="onDark" icon={<RotateCw className="size-4" />} onClick={onRedo}>
          Not quite, research again
        </Button>
      </div>
    </motion.div>
  );
}
