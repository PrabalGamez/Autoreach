import { useEffect, useState } from 'react';
import { Check, ExternalLink, Mail, Plus, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Health, Profile } from '../../../shared/types.ts';
import { Button, Input, Label, LogoPill, TextArea, cx, useToast } from '../components/ui.tsx';
import { Circuit } from '../components/Circuit.tsx';
import { api, post, put, useApi } from '../lib/api.ts';
import { AddTargets } from './Targets.tsx';

const STEPS = ['Profile', 'Voice', 'Gmail', 'Targets'] as const;
const GOALS = ['signing', 'sync', 'sponsorship', 'collab', 'paid gig'] as const;

export function Onboarding({ health, onHealth, onDone }: { health: Health; onHealth: () => void; onDone: () => void }) {
  const profile = useApi<Profile>('/api/profile');
  const [step, setStep] = useState(0);

  useEffect(() => {
    const p = profile.data;
    if (!p) return;
    // Resume where the person left off. Voice is optional, so a set Gmail address means it was done or skipped.
    if (p.alias && p.best_works.length) setStep((s) => Math.max(s, health.gmail.connected ? 3 : p.voice_profile ? 2 : 1));
  }, [profile.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  const titles: [string, string][] = [
    ['Tell Autoreach', 'who you are.'],
    ['Teach it', 'how you write.'],
    ['Send from', 'your real inbox.'],
    ['Pick who', 'to reach first.'],
  ];

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <Circuit />
      <div className="relative mx-auto grid max-w-[1240px] gap-10 px-4 pb-20 pt-5 md:px-6 lg:grid-cols-[1fr_minmax(0,560px)] lg:gap-16">
        <div className="lg:sticky lg:top-0 lg:h-dvh lg:pb-10">
          <LogoPill />
          <div className="mt-12 lg:mt-24">
            <p className="label">
              Step {step + 1} of {STEPS.length}
            </p>
            <AnimatePresence mode="wait">
              <motion.h1 key={step} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }} className="display mt-3 text-[48px] md:text-[72px]">
                <span className="text-ink">{titles[step][0]}</span>
                <br />
                <span className="text-hush">{titles[step][1]}</span>
              </motion.h1>
            </AnimatePresence>
            <ol className="mt-10 grid max-w-[360px] gap-2">
              {STEPS.map((s, i) => (
                <li key={s}>
                  <button
                    onClick={() => i < step && setStep(i)}
                    disabled={i > step}
                    className={cx('flex h-11 w-full items-center gap-3 rounded-[4px] px-3 text-left text-[15px] transition-colors duration-150', i === step ? 'bg-forest text-cream' : i < step ? 'bg-paper text-ink hover:bg-ground-2' : 'text-ink-3')}
                  >
                    <span className={cx('grid size-6 place-items-center rounded-[3px] text-[12px]', i < step ? 'bg-leaf text-white' : i === step ? 'bg-white/15' : 'bg-black/5')}>{i < step ? <Check className="size-3.5" /> : i + 1}</span>
                    {s}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="lg:pt-24">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}>
              {profile.data && step === 0 && <ProfileStep profile={profile.data} onSaved={(p) => (profile.setData(p), setStep(1), onHealth())} />}
              {profile.data && step === 1 && <VoiceStep profile={profile.data} onSaved={(p) => (profile.setData(p), setStep(2))} onSkip={() => setStep(2)} />}
              {step === 2 && <GmailStep health={health} onHealth={onHealth} onNext={() => setStep(3)} />}
              {step === 3 && <TargetsStep onDone={onDone} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ---------- Step 1 ----------
function ProfileStep({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    alias: profile.alias,
    real_name: profile.real_name,
    pitch: profile.pitch,
    niches: profile.niches.join(', '),
    links: profile.links.length ? profile.links : [{ label: 'Spotify', url: '' }, { label: 'SoundCloud', url: '' }, { label: 'Instagram', url: '' }],
    works: profile.best_works.length ? profile.best_works : [{ title: '', url: '', note: '' }],
    goals: profile.goals,
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      const p = await put<Profile>('/api/profile', {
        alias: f.alias.trim(),
        real_name: f.real_name.trim(),
        pitch: f.pitch.trim(),
        niches: f.niches.split(',').map((s) => s.trim()).filter(Boolean),
        links: f.links.filter((l) => l.url.trim()).map((l) => ({ label: l.label.trim() || 'Link', url: l.url.trim() })),
        best_works: f.works.filter((w) => w.url.trim()).map((w) => ({ title: w.title.trim() || 'Untitled', url: w.url.trim(), note: w.note.trim() })),
        goals: f.goals,
      });
      onSaved(p);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="paper-card grid gap-5 p-5 md:p-7">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="alias">Artist name or alias</Label>
          <Input id="alias" value={f.alias} onChange={(e) => set('alias', e.target.value)} autoComplete="nickname" />
        </div>
        <div>
          <Label htmlFor="real" hint="optional">
            Real name
          </Label>
          <Input id="real" value={f.real_name} onChange={(e) => set('real_name', e.target.value)} autoComplete="name" />
        </div>
      </div>
      <div>
        <Label htmlFor="pitch" hint="one line">
          Your pitch
        </Label>
        <Input id="pitch" value={f.pitch} onChange={(e) => set('pitch', e.target.value)} placeholder="Heavy 150 BPM dubstep with metallic growls and film-score builds" />
      </div>
      <div>
        <Label htmlFor="niches" hint="comma separated">
          Genres or niche
        </Label>
        <Input id="niches" value={f.niches} onChange={(e) => set('niches', e.target.value)} placeholder="dubstep, riddim, bass music" />
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[14px] font-medium text-ink-2">Links</legend>
        <div className="grid gap-2">
          {f.links.map((l, i) => (
            <div key={i} className="grid grid-cols-[110px_1fr_44px] gap-2">
              <Input aria-label="Link label" value={l.label} onChange={(e) => set('links', f.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <Input aria-label={`${l.label || 'Link'} URL`} type="url" value={l.url} placeholder="https://" onChange={(e) => set('links', f.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              <button aria-label="Remove link" className="grid place-items-center rounded-[4px] text-ink-3 hover:bg-black/5" onClick={() => set('links', f.links.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          <Button variant="ghost" size="sm" className="justify-self-start" icon={<Plus className="size-4" />} onClick={() => set('links', [...f.links, { label: '', url: '' }])}>
            Add link
          </Button>
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 text-[14px] font-medium text-ink-2">
          Your 2–3 best works <span className="font-normal text-ink-3">private links are fine</span>
        </legend>
        <div className="grid gap-3">
          {f.works.map((w, i) => (
            <div key={i} className="grid gap-2 rounded-[4px] bg-ground-2 p-3 shadow-[inset_0_0_0_1px_var(--color-line)] sm:grid-cols-2">
              <Input aria-label="Title" placeholder="Title" value={w.title} onChange={(e) => set('works', f.works.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <Input aria-label="URL" type="url" placeholder="https://soundcloud.com/…" value={w.url} onChange={(e) => set('works', f.works.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              <Input aria-label="Note" className="sm:col-span-2" placeholder="Note, e.g. 150 BPM, F minor, unreleased, stems ready" value={w.note} onChange={(e) => set('works', f.works.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
            </div>
          ))}
          {f.works.length < 3 && (
            <Button variant="ghost" size="sm" className="justify-self-start" icon={<Plus className="size-4" />} onClick={() => set('works', [...f.works, { title: '', url: '', note: '' }])}>
              Add work
            </Button>
          )}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-[14px] font-medium text-ink-2">What you want</legend>
        <div className="flex flex-wrap gap-2">
          {GOALS.map((g) => {
            const on = f.goals.includes(g);
            return (
              <button key={g} aria-pressed={on} onClick={() => set('goals', on ? f.goals.filter((x) => x !== g) : [...f.goals, g])} className={cx('h-10 rounded-[4px] px-4 text-[14px] capitalize transition-colors duration-150', on ? 'bg-forest text-cream' : 'bg-ground-2 text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-ground')}>
                {g}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="flex justify-end">
        <Button size="lg" onClick={save} busy={busy} disabled={!f.alias || !f.pitch || !f.goals.length || !f.works.some((w) => w.url)}>
          Save and continue
        </Button>
      </div>
    </div>
  );
}

// ---------- Step 2 ----------
function VoiceStep({ profile, onSaved, onSkip }: { profile: Profile; onSaved: (p: Profile) => void; onSkip: () => void }) {
  const toast = useToast();
  const [samples, setSamples] = useState<string[]>(profile.voice_samples.length ? profile.voice_samples : ['', '', '']);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(profile.voice_profile);

  const analyse = async () => {
    setBusy(true);
    try {
      const p = await post<Profile>('/api/profile/voice', { samples: samples.map((s) => s.trim()).filter((s) => s.length >= 40) });
      setResult(p.voice_profile);
      toast('Voice profile saved.', 'good');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="paper-card grid gap-4 p-5 md:p-7">
        <p className="text-[15px] text-ink-3">Paste 2–3 emails you wrote yourself. Claude reads them once and keeps a short style profile, so drafts sound like you.</p>
        {samples.map((s, i) => (
          <div key={i}>
            <Label htmlFor={`sample-${i}`} hint={i ? 'optional' : undefined}>
              Email {i + 1}
            </Label>
            <TextArea id={`sample-${i}`} rows={5} value={s} onChange={(e) => setSamples(samples.map((x, j) => (j === i ? e.target.value : x)))} placeholder="Hey Sam, …" />
          </div>
        ))}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onSkip}>
            Skip for now
          </Button>
          <Button variant="dark" onClick={analyse} busy={busy} disabled={!samples.some((s) => s.trim().length >= 40)}>
            {busy ? 'Reading your style…' : 'Analyse my style'}
          </Button>
        </div>
      </div>
      {result && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="dark-card on-dark p-5 md:p-6">
          <p className="text-[13px] text-cream/70">Your voice</p>
          <p className="mt-1 text-[22px] tracking-[-0.02em]">{result.tone}</p>
          <dl className="mt-4 grid gap-3 text-[14px] sm:grid-cols-3">
            <div>
              <dt className="text-cream/70">Length</dt>
              <dd>{result.typical_length}</dd>
            </div>
            <div>
              <dt className="text-cream/70">Opens with</dt>
              <dd>{result.greeting}</dd>
            </div>
            <div>
              <dt className="text-cream/70">Signs off</dt>
              <dd>{result.signoff}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {result.traits.map((t) => (
              <span key={t} className="rounded-[3px] bg-white/10 px-2 py-1 text-[13px]">
                {t}
              </span>
            ))}
          </div>
          <div className="mt-5 flex justify-end">
            <Button variant="light" onClick={() => onSaved({ ...profile, voice_profile: result })}>
              Looks like me, continue
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ---------- Step 3 ----------
const gmailCompose = (from: string, to: string, subject: string, body: string) =>
  `https://mail.google.com/mail/?authuser=${encodeURIComponent(from)}&view=cm&fs=1&tf=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** Default: just the Gmail address. Approved emails open in Gmail already written; you press Send. */
export function GmailStep({ health, onHealth, onNext }: { health: Health; onHealth: () => void; onNext?: () => void }) {
  const toast = useToast();
  const g = health.gmail;
  const [email, setEmail] = useState(g.email ?? '');
  const [editing, setEditing] = useState(!g.connected);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await post('/api/gmail/web', { email });
      onHealth();
      setEditing(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (g.connected && !editing) {
    return (
      <div className="dark-card on-dark grid gap-5 p-6 md:p-8">
        <span className="grid size-10 place-items-center rounded-[4px] bg-leaf text-white">
          <Check className="size-5" />
        </span>
        <div>
          <p className="text-[13px] text-cream/70">Sending from</p>
          <p className="mt-1 break-all text-[28px] tracking-[-0.03em]">{g.email}</p>
        </div>
        <p className="text-[15px] text-cream/80">
          {g.mode === 'gmail_api'
            ? 'Automatic mode: approved emails send on their own, 2–6 minutes apart, and replies are checked for you.'
            : 'Each email you approve opens in Gmail, already written. Check it and press Send. Autoreach never sees your password or your inbox.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {g.mode === 'gmail_web' && g.email && (
            <a
              href={gmailCompose(g.email, g.email, 'Autoreach test', 'This is how Autoreach hands you each email: written and ready. Press Send, or just close this window.')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-[4px] bg-paper px-4 text-[14px] font-medium text-ink transition-colors duration-150 hover:bg-ground-2"
            >
              <Mail className="size-4" /> Open a test email
            </a>
          )}
          <Button variant="onDark" onClick={() => setEditing(true)}>
            Change address
          </Button>
          {onNext && (
            <Button variant="primary" onClick={onNext}>
              Continue
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <form className="paper-card grid gap-5 p-5 md:p-7" onSubmit={(e) => (e.preventDefault(), save())}>
        <div>
          <Label htmlFor="gmail-addr">Your Gmail address</Label>
          <Input id="gmail-addr" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" />
        </div>
        <ul className="grid gap-2 text-[15px] text-ink-2">
          {['No passwords and no Google setup.', 'Each approved email opens in your Gmail, already written. You press Send.', 'Autoreach never reads your inbox. You paste replies in, and Claude spots offers.'].map((t) => (
            <li key={t} className="flex gap-2">
              <Check className="mt-1 size-4 shrink-0 text-moss" /> {t}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          {g.connected && (
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
          <Button type="submit" size="lg" busy={busy} disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}>
            Use this Gmail
          </Button>
        </div>
      </form>
      <details className="group rounded-[6px] bg-ground-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
        <summary className="flex h-12 items-center px-4 text-[14px] text-ink-2">Advanced: automatic sending and reply alerts (needs a Google Cloud setup)</summary>
        <div className="p-4 pt-0">
          <AdvancedGmail health={health} />
        </div>
      </details>
    </div>
  );
}

/** Optional automatic mode: your own Google OAuth client, so Autoreach can send and watch replies by itself. */
function AdvancedGmail({ health }: { health: Health }) {
  const toast = useToast();
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const g = health.gmail;

  const connect = async () => {
    setBusy(true);
    try {
      if (!health.fakeGmail && (clientId || !g.hasClient)) await post('/api/gmail/client', { clientId: clientId.trim(), clientSecret: secret.trim() });
      const { url } = await api<{ url: string }>('/api/gmail/auth-url');
      window.location.href = url;
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  };

  if (health.fakeGmail)
    return (
      <Button onClick={connect} busy={busy}>
        Connect demo mailbox
      </Button>
    );

  return (
    <div className="grid gap-4">
      <ol className="dark-card on-dark grid gap-4 p-5 text-[14px] md:p-6">
        <li className="text-[13px] text-cream/70">About 5 minutes, once. Google needs your own OAuth app because Autoreach has no server.</li>
        {[
          <>Open <a className="underline decoration-cream/40 underline-offset-2 hover:decoration-cream" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud console <ExternalLink className="inline size-3" /></a> and create a project called Autoreach.</>,
          <>In <b>APIs &amp; Services → Library</b>, enable the <b>Gmail API</b>.</>,
          <>In <b>Google Auth Platform → Branding/Audience</b>: user type External, app name Autoreach, your email. Add <code className="font-mono text-[12px]">gmail.send</code> and <code className="font-mono text-[12px]">gmail.readonly</code> under Data access.</>,
          <>In <b>Audience</b>, press <b>Publish app</b>. In "Testing", Google signs you out every 7 days. You will see an "unverified app" warning once.</>,
          <>In <b>Clients</b>, create an OAuth client of type <b>Desktop app</b>. Copy the Client ID and secret below.</>,
        ].map((x, i) => (
          <li key={i} className="grid grid-cols-[28px_1fr] gap-2">
            <span className="grid size-6 place-items-center rounded-[3px] bg-white/10 text-[12px]">{i + 1}</span>
            <span className="text-cream/90">{x}</span>
          </li>
        ))}
      </ol>
      <div className="paper-card grid gap-4 p-5 md:p-6">
        <div>
          <Label htmlFor="cid">Client ID</Label>
          <Input id="cid" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={g.hasClient ? 'Saved in your keychain. Paste to replace.' : '1234…apps.googleusercontent.com'} autoComplete="off" spellCheck={false} />
        </div>
        <div>
          <Label htmlFor="csec">Client secret</Label>
          <Input id="csec" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={g.hasClient ? '••••••••' : 'GOCSPX-…'} autoComplete="off" />
        </div>
        <p className="text-[13px] text-ink-3">Stored in your macOS Keychain, never in a file.</p>
        {g.error && <p className="text-[14px] text-alarm">{g.error}</p>}
        <Button className="justify-self-end" onClick={connect} busy={busy} disabled={!g.hasClient && (!clientId || !secret)}>
          Connect for automatic sending
        </Button>
      </div>
    </div>
  );
}

// ---------- Step 4 ----------
function TargetsStep({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const finish = async () => {
    setBusy(true);
    try {
      await post('/api/onboarding/complete');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4">
      <AddTargets compact />
      <div className="flex justify-end">
        <Button size="lg" onClick={finish} busy={busy}>
          Finish setup
        </Button>
      </div>
    </div>
  );
}
