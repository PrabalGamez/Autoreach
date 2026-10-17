import { useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Ban, Check, FileUp, Link2, Loader2, RotateCw, Search, Sparkles, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Person, Target } from '../../../shared/types.ts';
import { Badge, Button, Empty, Input, Label, Monogram, Select, TextArea, TwoTone, cx, useToast } from '../components/ui.tsx';
import { Circuit } from '../components/Circuit.tsx';
import { del, patch, post, useApi } from '../lib/api.ts';
import type { Route } from '../components/Shell.tsx';

type T = Target & { busy?: boolean };

export const STATUS_LABEL: Record<string, string> = {
  proposed: 'Proposed',
  researching: 'Researching',
  draft_ready: 'Draft ready',
  approved: 'Approved',
  sent: 'Sent',
  replied: 'Replied',
  offer: 'Offer',
  closed: 'Closed',
  declined: 'Declined',
  rejected: 'Rejected',
};

export function Targets({ go }: { go: (r: Route) => void }) {
  const targets = useApi<T[]>('/api/targets', 4000);
  const jobs = useApi<{ task: string; state: string; error: string | null; target_id: number | null; created_at: string }[]>('/api/jobs', 4000);
  const [q, setQ] = useState('');
  const all = targets.data ?? [];
  const proposed = all.filter((t) => t.status === 'proposed');
  const list = all.filter((t) => t.status !== 'proposed' && t.status !== 'rejected' && (!q || `${t.name} ${t.domain ?? ''} ${t.contact_email ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const proposing = jobs.data?.some((j) => j.task === 'propose_targets' && (j.state === 'running' || j.state === 'queued'));
  const failures = (jobs.data ?? []).filter((j) => j.state === 'failed' && j.target_id).slice(0, 20);
  const failedFor = (id: number) => failures.find((j) => j.target_id === id);

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <TwoTone a="Targets" b={`${list.length} on your list`} className="text-[40px] md:text-[56px]" />
        {all.some((t) => t.status === 'draft_ready') && (
          <Button onClick={() => go('review')} icon={<ArrowUpRight className="size-4" />}>
            Review drafts
          </Button>
        )}
      </div>

      <AddTargets onAdded={targets.reload} proposing={Boolean(proposing)} />

      <AnimatePresence>
        {proposed.length > 0 && (
          <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid gap-3">
            <h2 className="text-[20px] font-medium tracking-[-0.02em]">
              Proposals <span className="text-hush">· approve or reject each one</span>
            </h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {proposed.map((t, i) => (
                <ProposalCard key={t.id} t={t} i={i} onChange={targets.reload} />
              ))}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[20px] font-medium tracking-[-0.02em]">All targets</h2>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <Input aria-label="Search targets" className="pl-9" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {!list.length ? (
          <Empty title="No targets yet">Ask Autoreach for a list, import a CSV, or add one by hand.</Empty>
        ) : (
          <div className="paper-card overflow-hidden">
            <ul className="divide-y divide-line">
              {list.map((t) => (
                <TargetRow key={t.id} t={t} failed={failedFor(t.id)?.error ?? null} onChange={targets.reload} />
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function ProposalCard({ t, i, onChange }: { t: T; i: number; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<'a' | 'r' | null>(null);
  const act = async (kind: 'accept' | 'reject') => {
    setBusy(kind === 'accept' ? 'a' : 'r');
    try {
      await post(`/api/targets/${t.id}/${kind}`);
      if (kind === 'accept') toast(`Researching ${t.name}. The draft lands in Review.`, 'good');
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(null);
    }
  };
  return (
    <motion.article initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="dark-card on-dark flex flex-col p-5">
      <div className="flex items-start gap-3">
        <Monogram name={t.name} domain={t.domain} dark />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-medium tracking-[-0.02em]">{t.name}</p>
          <p className="truncate text-[13px] text-cream/70">{t.domain ?? t.kind}</p>
        </div>
        {t.route === 'form_only' ? <Badge tone="form">Form only</Badge> : <Badge tone="dark">Email</Badge>}
      </div>
      <p className="mt-4 text-[14px] leading-relaxed text-cream/90">{t.why_fit}</p>
      <p className="mt-3 text-[13px] text-cream/70">{t.route === 'form_only' ? `Submit via ${t.form_url ? new URL(t.form_url).hostname : 'their form'}` : `Public contact: ${t.contact_email}`}</p>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
        {t.proposal_sources.slice(0, 3).map((s) => (
          <a key={s} href={s} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-cream/70 underline decoration-cream/30 underline-offset-2 hover:text-cream">
            <Link2 className="size-3" /> {safeHost(s)}
          </a>
        ))}
      </div>
      <div className="mt-auto flex gap-2 pt-5">
        <Button variant="light" size="sm" busy={busy === 'a'} icon={<Check className="size-4" />} onClick={() => act('accept')}>
          Approve
        </Button>
        <Button variant="onDark" size="sm" busy={busy === 'r'} icon={<X className="size-4" />} onClick={() => act('reject')}>
          Reject
        </Button>
      </div>
    </motion.article>
  );
}

const safeHost = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

function TargetRow({ t, failed, onChange }: { t: T; failed: string | null; onChange: () => void }) {
  const toast = useToast();
  const people = useApi<Person[]>('/api/people');
  const [open, setOpen] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok, 'good');
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const researching = t.status === 'researching' || t.busy;
  return (
    <li>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-5">
        <Monogram name={t.name} domain={t.domain} size={36} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
            {t.name}
            {t.referrer_name && <Badge tone="warm">Warm · {t.referrer_name}</Badge>}
            {t.route === 'form_only' && <Badge tone="form">Form only</Badge>}
            {t.suppressed && <Badge tone="bad">Opted out</Badge>}
          </p>
          <p className="truncate text-[13px] text-ink-3">{t.contact_email ?? t.form_url ?? t.domain ?? '—'}</p>
          {failed && t.status === 'researching' && <p className="mt-1 text-[13px] text-alarm">Last attempt failed: {failed.slice(0, 160)}</p>}
        </div>
        <span className={cx('inline-flex h-7 items-center gap-1.5 rounded-[3px] px-2 text-[12px] font-medium', t.status === 'offer' ? 'bg-ember text-white' : 'bg-ground-2 text-ink-2 shadow-[0_0_0_1px_var(--color-line)]')}>
          {researching && <Loader2 className="size-3 animate-spin" aria-hidden />}
          {STATUS_LABEL[t.status]}
        </span>
        <button className="h-9 rounded-[4px] px-3 text-[13px] text-ink-2 hover:bg-black/5" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Manage'}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="grid gap-3 bg-ground-2 px-4 py-4 md:grid-cols-[1fr_auto] md:px-5">
              <div className="grid gap-2 sm:max-w-sm">
                <Label htmlFor={`ref-${t.id}`}>Referred by</Label>
                <Select id={`ref-${t.id}`} value={t.referred_by ?? ''} onChange={(e) => run(() => patch(`/api/targets/${t.id}`, { referred_by: e.target.value ? Number(e.target.value) : null }), 'Saved. Use Research and redraft to apply the warm intro.')}>
                  <option value="">Nobody (cold)</option>
                  {(people.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Button variant="light" size="sm" icon={<RotateCw className="size-4" />} disabled={researching && !failed} onClick={() => run(() => post(`/api/targets/${t.id}/research`), 'Researching again.')}>
                  Research and redraft
                </Button>
                {!t.suppressed && (
                  <Button variant="light" size="sm" icon={<Ban className="size-4" />} onClick={() => confirm(`Mark ${t.name} as opted out? Autoreach will never contact them again.`) && run(() => post(`/api/targets/${t.id}/opt-out`), 'Marked as opted out.')}>
                    Opted out
                  </Button>
                )}
                <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} onClick={() => confirm(`Delete ${t.name} and its drafts?`) && run(() => del(`/api/targets/${t.id}`))}>
                  Delete
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

// ---------- Add targets: ask / import / manual ----------
export function AddTargets({ onAdded, proposing, compact }: { onAdded?: () => void; proposing?: boolean; compact?: boolean }) {
  const [tab, setTab] = useState<'ask' | 'import' | 'manual'>('ask');
  return (
    <section className="satin relative overflow-hidden rounded-[10px] p-5 text-cream md:p-8">
      <Circuit dark nodes={false} />
      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={cx('headline', compact ? 'text-[26px]' : 'text-[30px] md:text-[40px]')}>
            Who should hear <span className="text-cream/60">from you?</span>
          </p>
          <div role="tablist" aria-label="Add targets" className="flex rounded-[4px] bg-white/10 p-1">
            {(
              [
                ['ask', 'Ask Autoreach'],
                ['import', 'Import'],
                ['manual', 'Add one'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('h-9 rounded-[3px] px-3 text-[13px] transition-colors duration-150', tab === id ? 'bg-cream text-ink' : 'text-cream/80 hover:text-cream')}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-6">
          {tab === 'ask' && <AskPanel onAdded={onAdded} proposing={proposing} />}
          {tab === 'import' && <ImportPanel onAdded={onAdded} />}
          {tab === 'manual' && <ManualPanel onAdded={onAdded} />}
        </div>
      </div>
    </section>
  );
}

function AskPanel({ onAdded, proposing }: { onAdded?: () => void; proposing?: boolean }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const examples = ['Companies in my niche that accept pitches, active in the last 6 months', 'Brands that sponsor or partner with people like me', 'Podcasts, newsletters or channels that feature work in my field'];
  const go = async () => {
    setBusy(true);
    try {
      await post('/api/targets/propose', { query: q });
      toast('Claude is researching. Proposals appear here in a few minutes.', 'good');
      onAdded?.();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="ask" className="sr-only">
          Describe who you want to reach
        </label>
        <input id="ask" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && q.length > 4 && go()} placeholder="Describe who you want to reach" className="h-12 min-w-0 flex-1 rounded-[4px] bg-cream px-4 text-[15px] text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-ember" />
        <Button variant="ember" size="lg" onClick={go} busy={busy} disabled={q.length < 5 || proposing} icon={<Sparkles className="size-4" />}>
          {proposing ? 'Researching…' : 'Find targets'}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {examples.map((e) => (
          <button key={e} onClick={() => setQ(e)} className="rounded-[3px] bg-white/10 px-2.5 py-1.5 text-left text-[13px] text-cream/85 hover:bg-white/15">
            {e}
          </button>
        ))}
      </div>
      {proposing && (
        <p className="flex items-center gap-2 text-[14px] text-cream/80">
          <Loader2 className="size-4 animate-spin" /> Searching the web and checking each submission route. This takes a few minutes.
        </p>
      )}
      <p className="text-[13px] text-cream/60">Only publicly listed business or submission contacts are used. Targets that only take pitches through a form or platform are marked form only and never emailed.</p>
    </div>
  );
}

function ImportPanel({ onAdded }: { onAdded?: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const run = async () => {
    setBusy(true);
    try {
      const r = await post<{ added: Target[]; duplicates: string[]; skipped: string[] }>('/api/targets/import', { text });
      toast(`Added ${r.added.length}. ${r.duplicates.length ? `${r.duplicates.length} duplicates skipped. ` : ''}${r.skipped.length ? `${r.skipped.length} opted out.` : ''}`, 'good');
      setText('');
      onAdded?.();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <TextArea aria-label="CSV or pasted list" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'name,contact,notes\nSome Company,hello@somecompany.com,met at a conference\nOther Company,https://othercompany.com/apply,form only'} className="border-transparent bg-cream font-mono text-[13px]" />
      <div className="flex flex-wrap items-center gap-2">
        <input ref={file} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={async (e) => setText(await e.target.files![0].text())} />
        <Button variant="subtle" icon={<FileUp className="size-4" />} onClick={() => file.current?.click()}>
          Choose CSV
        </Button>
        <Button variant="light" onClick={run} busy={busy} disabled={!text.trim()}>
          Import
        </Button>
        <p className="text-[13px] text-cream/60">Columns: name, contact (email or URL), notes. Duplicates by domain or email are skipped.</p>
      </div>
    </div>
  );
}

function ManualPanel({ onAdded }: { onAdded?: () => void }) {
  const toast = useToast();
  const people = useApi<Person[]>('/api/people');
  const blank = { name: '', kind: 'company', domain: '', contact_email: '', contact_source_url: '', route: 'email', form_url: '', referred_by: '', notes: '' };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof blank, v: string) => setF((x) => ({ ...x, [k]: v }));
  const valid = useMemo(() => f.name && (f.route === 'email' ? /@/.test(f.contact_email) : /^https?:\/\//.test(f.form_url)), [f]);
  const save = async () => {
    setBusy(true);
    try {
      await post('/api/targets', {
        name: f.name,
        kind: f.kind,
        domain: f.domain || null,
        contact_email: f.route === 'email' ? f.contact_email : null,
        contact_source_url: f.contact_source_url || null,
        route: f.route,
        form_url: f.route === 'form_only' ? f.form_url : null,
        referred_by: f.referred_by ? Number(f.referred_by) : null,
        notes: f.notes,
      });
      toast(`Added ${f.name}. Research has started.`, 'good');
      setF(blank);
      onAdded?.();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const dark = 'border-transparent bg-cream';
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Input aria-label="Name" placeholder="Name" className={dark} value={f.name} onChange={(e) => set('name', e.target.value)} />
      <Select aria-label="Kind" className={dark} value={f.kind} onChange={(e) => set('kind', e.target.value)}>
        <option value="company">Company</option>
        <option value="brand">Brand</option>
        <option value="person">Person</option>
        <option value="other">Other</option>
      </Select>
      <Select aria-label="How they take pitches" className={dark} value={f.route} onChange={(e) => set('route', e.target.value)}>
        <option value="email">They list a business email</option>
        <option value="form_only">Form or platform only (e.g. LabelRadar, an application portal)</option>
      </Select>
      {f.route === 'email' ? (
        <Input aria-label="Public business email" type="email" placeholder="hello@company.com" className={dark} value={f.contact_email} onChange={(e) => set('contact_email', e.target.value)} />
      ) : (
        <Input aria-label="Submission form URL" type="url" placeholder="https://www.labelradar.com/labels/…" className={dark} value={f.form_url} onChange={(e) => set('form_url', e.target.value)} />
      )}
      <Input aria-label="Website" placeholder="Website (optional)" className={dark} value={f.domain} onChange={(e) => set('domain', e.target.value)} />
      {f.route === 'email' && <Input aria-label="Where is the email listed?" type="url" placeholder="Where the email is listed (URL)" className={dark} value={f.contact_source_url} onChange={(e) => set('contact_source_url', e.target.value)} />}
      <Select aria-label="Referred by" className={dark} value={f.referred_by} onChange={(e) => set('referred_by', e.target.value)}>
        <option value="">Referred by: nobody</option>
        {(people.data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            Referred by {p.name}
          </option>
        ))}
      </Select>
      <Input aria-label="Notes" placeholder="Notes for research (optional)" className={cx(dark, 'sm:col-span-2')} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      <div className="sm:col-span-2">
        <Button variant="light" onClick={save} busy={busy} disabled={!valid}>
          Add and research
        </Button>
      </div>
    </div>
  );
}
