import { useState } from 'react';
import { Sparkles, Trash2, UserPlus } from 'lucide-react';
import type { Person } from '../../../shared/types.ts';
import { Button, Empty, Input, Label, Section, Select, TextArea, TwoTone, useToast } from '../components/ui.tsx';
import { del, post, patch, useApi } from '../lib/api.ts';
import type { Route } from '../components/Shell.tsx';

interface Outcome {
  id: number;
  person_id: number;
  target_id: number;
  person_name: string;
  target_name: string;
  target_status: string;
  stage: string;
  reason: string;
}
const STAGES = [
  ['suggested', 'Suggested'],
  ['asked', 'Asked'],
  ['intro_made', 'Intro made'],
  ['replied', 'Target replied'],
  ['offer', 'Led to offer'],
  ['none', 'Went nowhere'],
] as const;

export function Referrals({ go }: { go: (r: Route) => void }) {
  const people = useApi<Person[]>('/api/people');
  const outcomes = useApi<Outcome[]>('/api/referrals', 5000);
  const jobs = useApi<{ task: string; state: string }[]>('/api/jobs', 4000);
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', relationship: '', notes: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const matching = jobs.data?.some((j) => j.task === 'intro_match' && ['queued', 'running'].includes(j.state));

  const add = async () => {
    setBusy('add');
    try {
      await post('/api/people', { ...f, email: f.email || null });
      setF({ name: '', email: '', relationship: '', notes: '' });
      people.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  const suggest = async () => {
    setBusy('suggest');
    try {
      await post('/api/referrals/suggest');
      toast('Claude is matching your contacts to targets. Intro requests land in Review.', 'good');
      jobs.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  // Which connections led somewhere: count stages per person.
  const byPerson = new Map<string, { asked: number; intros: number; offers: number }>();
  for (const o of outcomes.data ?? []) {
    const r = byPerson.get(o.person_name) ?? { asked: 0, intros: 0, offers: 0 };
    if (o.stage !== 'suggested') r.asked++;
    if (['intro_made', 'replied', 'offer'].includes(o.stage)) r.intros++;
    if (o.stage === 'offer') r.offers++;
    byPerson.set(o.person_name, r);
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <TwoTone a="Referrals" b="warm beats cold" className="text-[40px] md:text-[56px]" />
        <Button variant="ember" icon={<Sparkles className="size-4" />} busy={busy === 'suggest' || matching} onClick={suggest}>
          {matching ? 'Matching…' : 'Suggest intros'}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="grid content-start gap-4">
          <Section title="People you know">
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="pn">Name</Label>
                  <Input id="pn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="pe" hint="needed to send">
                    Email
                  </Label>
                  <Input id="pe" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
                </div>
              </div>
              <div>
                <Label htmlFor="pr">How you know them</Label>
                <Input id="pr" placeholder="e.g. Worked together on a project in 2025" value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="pnotes" hint="who they might know">
                  Notes
                </Label>
                <TextArea id="pnotes" rows={3} placeholder="e.g. Worked with their founder last year" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
              </div>
              <Button className="justify-self-start" variant="dark" icon={<UserPlus className="size-4" />} busy={busy === 'add'} disabled={!f.name} onClick={add}>
                Add person
              </Button>
            </div>
          </Section>

          {(people.data?.length ?? 0) > 0 && (
            <ul className="paper-card divide-y divide-line">
              {people.data!.map((p) => {
                const s = byPerson.get(p.name);
                return (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium">{p.name}</p>
                      <p className="truncate text-[13px] text-ink-3">{p.relationship || p.email || 'No details'}</p>
                    </div>
                    {s && (
                      <span className="text-[12px] text-ink-3">
                        {s.intros} intro{s.intros === 1 ? '' : 's'} · {s.offers} offer{s.offers === 1 ? '' : 's'}
                      </span>
                    )}
                    <button aria-label={`Remove ${p.name}`} className="grid size-11 place-items-center rounded-[4px] text-ink-3 hover:bg-black/5" onClick={() => confirm(`Remove ${p.name}?`) && del(`/api/people/${p.id}`).then(people.reload)}>
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Section title="Intro tracker" aside={<Button size="sm" variant="light" onClick={() => go('review')}>Open Review</Button>}>
          {!outcomes.data?.length ? (
            <Empty title="No intros yet">Add the people you know, then press Suggest intros. Claude only suggests a match when your notes give a real reason.</Empty>
          ) : (
            <ul className="grid gap-2">
              {outcomes.data.map((o) => (
                <li key={o.id} className="grid gap-2 rounded-[4px] bg-ground-2 p-3 shadow-[inset_0_0_0_1px_var(--color-line)] sm:grid-cols-[1fr_180px] sm:items-center">
                  <div className="min-w-0">
                    <p className="text-[15px]">
                      <span className="font-medium">{o.person_name}</span> <span className="text-ink-3">→</span> <span className="font-medium">{o.target_name}</span>
                    </p>
                    <p className="text-[13px] text-ink-3">{o.reason}</p>
                  </div>
                  <label className="sr-only" htmlFor={`st-${o.id}`}>
                    Stage
                  </label>
                  <Select id={`st-${o.id}`} value={o.stage} className="h-10 py-1 text-[14px]" onChange={(e) => patch(`/api/referrals/${o.id}`, { stage: e.target.value }).then(outcomes.reload)}>
                    {STAGES.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
