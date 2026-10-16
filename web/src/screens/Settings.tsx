import { useEffect, useState } from 'react';
import { Download, Mail, RefreshCw, Trash2, Unplug } from 'lucide-react';
import type { Health, Profile } from '../../../shared/types.ts';
import { Button, Input, Label, Section, Select, TextArea, Toggle, TwoTone, useToast } from '../components/ui.tsx';
import { api, post, put, useApi } from '../lib/api.ts';

interface S {
  daily_cap: number;
  gap_min_minutes: number;
  gap_max_minutes: number;
  followups_enabled: boolean;
  followup_days: number;
  poll_minutes: number;
  send_window_start: number;
  send_window_end: number;
  model_drafting: string;
  model_research: string;
  model_classify: string;
  alert_email: boolean;
  alert_desktop: boolean;
  offer_confidence: number;
}

const MODELS = ['sonnet', 'opus', 'haiku'];

export function Settings({ health, onHealth }: { health: Health; onHealth: () => void }) {
  const toast = useToast();
  const settings = useApi<S>('/api/settings');
  const profile = useApi<Profile>('/api/profile');
  const [s, setS] = useState<S | null>(null);
  const [voice, setVoice] = useState<Profile['voice_profile']>(null);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    setS(settings.data);
  }, [settings.data]);
  useEffect(() => {
    setVoice(profile.data?.voice_profile ?? null);
    setAddress(profile.data?.postal_address ?? '');
  }, [profile.data]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast(ok, 'good');
      onHealth();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  if (!s) return <div className="h-[60vh]" />;
  const num = (k: keyof S) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) });

  return (
    <div className="grid gap-6">
      <TwoTone a="Settings" b="limits, voice, data" className="text-[40px] md:text-[56px]" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Sending limits" aside={<Button size="sm" busy={busy === 's'} onClick={() => run('s', () => put('/api/settings', s), 'Saved.')}>Save</Button>}>
          <div className="grid gap-5">
            <div>
              <Label htmlFor="cap" hint="hard cap 50, protects your sender reputation">
                Emails per day: <span className="text-ink">{s.daily_cap}</span>
              </Label>
              <input id="cap" type="range" min={1} max={50} value={s.daily_cap} onChange={num('daily_cap')} className="w-full accent-[var(--color-moss)]" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="gmin">Min gap (min)</Label>
                <Input id="gmin" type="number" min={1} max={60} value={s.gap_min_minutes} onChange={num('gap_min_minutes')} />
              </div>
              <div>
                <Label htmlFor="gmax">Max gap (min)</Label>
                <Input id="gmax" type="number" min={1} max={120} value={s.gap_max_minutes} onChange={num('gap_max_minutes')} />
              </div>
              <div>
                <Label htmlFor="ws" hint="recipient's time">
                  Window starts
                </Label>
                <Input id="ws" type="number" min={0} max={23} value={s.send_window_start} onChange={num('send_window_start')} />
              </div>
              <div>
                <Label htmlFor="we">Window ends</Label>
                <Input id="we" type="number" min={1} max={24} value={s.send_window_end} onChange={num('send_window_end')} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-[4px] bg-ground-2 p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
              <div>
                <p className="text-[15px] font-medium">One follow-up if no reply</p>
                <p className="text-[13px] text-ink-3">Drafted for your review, never sent on its own. Max one per target.</p>
              </div>
              <Toggle id="fu" label="Follow-ups" checked={s.followups_enabled} onChange={(v) => setS({ ...s, followups_enabled: v })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="fud">Follow up after (days)</Label>
                <Input id="fud" type="number" min={2} max={60} value={s.followup_days} onChange={num('followup_days')} />
              </div>
              <div>
                <Label htmlFor="poll">Check replies every (min)</Label>
                <Input id="poll" type="number" min={2} max={120} value={s.poll_minutes} onChange={num('poll_minutes')} />
              </div>
            </div>
          </div>
        </Section>

        <div className="grid content-start gap-4">
          <Section title="Gmail">
            <div className="grid gap-3">
              <p className="text-[15px]">
                {health.gmail.connected ? (
                  <>
                    Sending as <strong className="font-medium">{health.gmail.email}</strong>
                  </>
                ) : (
                  'Not connected'
                )}
              </p>
              {health.gmail.error && <p className="text-[14px] text-alarm">{health.gmail.error}</p>}
              <div className="flex flex-wrap gap-2">
                {health.gmail.connected ? (
                  <>
                    <Button variant="light" size="sm" icon={<Mail className="size-4" />} busy={busy === 'test'} onClick={() => run('test', () => post('/api/gmail/test'), 'Test email sent.')}>
                      Send test
                    </Button>
                    <Button variant="light" size="sm" icon={<RefreshCw className="size-4" />} onClick={() => run('poll', () => post('/api/gmail/poll'), 'Checking for replies.')}>
                      Check replies now
                    </Button>
                    <Button variant="ghost" size="sm" icon={<Unplug className="size-4" />} onClick={() => confirm('Disconnect Gmail? Sending and reply checks stop.') && run('dc', () => post('/api/gmail/disconnect'), 'Disconnected.')}>
                      Disconnect
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={async () => (window.location.href = (await api<{ url: string }>('/api/gmail/auth-url')).url)}>
                    Reconnect Gmail
                  </Button>
                )}
              </div>
              <div>
                <Label htmlFor="addr" hint="optional footer on outreach emails">
                  Postal address
                </Label>
                <div className="flex gap-2">
                  <Input id="addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="City, Country" />
                  <Button variant="light" onClick={() => run('addr', () => put('/api/profile', { postal_address: address }), 'Saved.')}>
                    Save
                  </Button>
                </div>
              </div>
            </div>
          </Section>

          <Section title="Offer alerts" aside={<Button size="sm" variant="light" busy={busy === 'a'} onClick={() => run('a', () => put('/api/settings', s), 'Saved.')}>Save</Button>}>
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[15px]">Email me ("🔥 Autoreach: offer from …")</span>
                <Toggle id="ae" label="Email alerts" checked={s.alert_email} onChange={(v) => setS({ ...s, alert_email: v })} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[15px]">macOS notification with sound</span>
                <Toggle id="ad" label="Desktop alerts" checked={s.alert_desktop} onChange={(v) => setS({ ...s, alert_desktop: v })} />
              </div>
              <p className="text-[13px] text-ink-3">The full-screen warning on next open is always on. WhatsApp alerts are skipped in this build.</p>
            </div>
          </Section>
        </div>

        <Section title="Voice profile" aside={<Button size="sm" busy={busy === 'v'} disabled={!voice} onClick={() => run('v', () => put('/api/profile/voice', voice), 'Voice saved.')}>Save</Button>}>
          {voice ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {(['tone', 'typical_length', 'greeting', 'signoff'] as const).map((k) => (
                <div key={k}>
                  <Label htmlFor={`v-${k}`}>{k.replace('_', ' ')}</Label>
                  <Input id={`v-${k}`} value={voice[k]} onChange={(e) => setVoice({ ...voice, [k]: e.target.value })} />
                </div>
              ))}
              <div className="sm:col-span-2">
                <Label htmlFor="v-traits" hint="one per line">
                  Traits
                </Label>
                <TextArea id="v-traits" rows={3} value={voice.traits.join('\n')} onChange={(e) => setVoice({ ...voice, traits: e.target.value.split('\n').filter(Boolean) })} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="v-avoid" hint="one per line">
                  Avoid
                </Label>
                <TextArea id="v-avoid" rows={2} value={voice.avoid.join('\n')} onChange={(e) => setVoice({ ...voice, avoid: e.target.value.split('\n').filter(Boolean) })} />
              </div>
            </div>
          ) : (
            <p className="text-[15px] text-ink-3">No voice profile yet. Drafts use a plain, direct default.</p>
          )}
        </Section>

        <div className="grid content-start gap-4">
          <Section title="Claude models" aside={<Button size="sm" variant="light" busy={busy === 'm'} onClick={() => run('m', () => put('/api/settings', s), 'Saved.')}>Save</Button>}>
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ['model_research', 'Research'],
                  ['model_drafting', 'Drafting'],
                  ['model_classify', 'Reply reading'],
                ] as const
              ).map(([k, l]) => (
                <div key={k}>
                  <Label htmlFor={k}>{l}</Label>
                  <Select id={k} value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })}>
                    {MODELS.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[13px] text-ink-3">
              Runs through Claude Code {health.claude?.version} with your login. Usage counts against your Claude plan.
            </p>
          </Section>

          <Section title="Your data">
            <div className="grid gap-3">
              <p className="text-[14px] text-ink-3">Everything lives in ~/.autoreach on this Mac. Tokens are in your Keychain.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="light" size="sm" icon={<Download className="size-4" />} onClick={() => (window.location.href = '/api/export')}>
                  Export JSON
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  icon={<Trash2 className="size-4" />}
                  onClick={() => {
                    const c = prompt('This deletes your profile, targets, drafts, history and Gmail tokens. The opt-out list is kept so nobody who opted out is contacted again. Type DELETE to confirm.');
                    if (c) run('del', () => post('/api/data/delete', { confirm: c }), 'All data deleted.');
                  }}
                >
                  Delete everything
                </Button>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
