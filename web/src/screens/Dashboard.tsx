import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Flame, MailCheck, Reply, Send } from 'lucide-react';
import { Empty, Section, TwoTone, cx } from '../components/ui.tsx';
import { useApi } from '../lib/api.ts';

interface Stats {
  sent: number;
  replied: number;
  replyRate: number;
  offers: number;
  interested: number;
  byDay: { d: string; n: number }[];
  bestSubjects: { subject: string; target_name: string; label: string }[];
  recentSubjects: { subject: string; target_name: string; label: string | null }[];
  warmVsCold: { k: string; sent: number; replied: number }[];
  angles: { type: string; targets: number; replied: number }[];
  queue: { queued: number; sentToday: number; cap: number };
}

// Sequential ramp: one hue (moss), light to dark. Empty days use the ground line colour.
const RAMP = ['#d3cec7', '#b7c4b8', '#8ba392', '#5d8169', '#2f5640', '#16261c'];
const LABEL: Record<string, string> = { offer: 'Offer', interested: 'Interested', decline: 'Declined', other: 'Replied', opt_out: 'Opted out' };

export function Dashboard() {
  const s = useApi<Stats>('/api/dashboard', 10000);
  if (!s.data) return <div className="h-[60vh]" />;
  const d = s.data;
  const tiles = [
    { label: 'Sent', value: String(d.sent), sub: `${d.queue.sentToday}/${d.queue.cap} today · ${d.queue.queued} queued`, Icon: Send },
    { label: 'Reply rate', value: `${Math.round(d.replyRate * 100)}%`, sub: `${d.replied} of ${d.sent} replied`, Icon: Reply },
    { label: 'Interested', value: String(d.interested), sub: 'asked for more', Icon: MailCheck },
    { label: 'Offers', value: String(d.offers), sub: d.offers ? 'check Pipeline' : 'none yet', Icon: Flame, hot: d.offers > 0 },
  ];

  return (
    <div className="grid gap-6">
      <TwoTone a="Dashboard" b="what's working" className="text-[40px] md:text-[56px]" />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t, i) => (
          <motion.div key={t.label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07, duration: 0.35 }} className={cx('dark-card p-5', t.hot && 'bg-[#3a1d10]')}>
            <div className="flex items-center justify-between">
              <p className="text-[14px] font-medium">{t.label}</p>
              <span className="grid size-7 place-items-center rounded-[4px] bg-white/10">
                <t.Icon className="size-3.5" aria-hidden />
              </span>
            </div>
            <p className="mt-4 text-[40px] leading-none tracking-[-0.04em]">{t.value}</p>
            <p className="mt-3 inline-flex rounded-[3px] bg-white/10 px-2 py-1 text-[12px] text-cream/80">{t.sub}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Section title="Sends, last 12 weeks">
          <Heatmap byDay={d.byDay} />
        </Section>
        <Section title="Warm vs cold">
          <WarmCold rows={d.warmVsCold} />
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Subject lines that got answers">
          {d.bestSubjects.length ? (
            <ul className="grid gap-2">
              {d.bestSubjects.map((b) => (
                <li key={b.subject + b.target_name} className="flex items-start gap-3 rounded-[4px] bg-ground-2 px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px]">{b.subject}</span>
                    <span className="text-[13px] text-ink-3">{b.target_name}</span>
                  </span>
                  <span className={cx('shrink-0 rounded-[3px] px-2 py-0.5 text-[12px] font-medium', b.label === 'offer' ? 'bg-ember text-white' : 'bg-leaf/15 text-[#235a36]')}>{LABEL[b.label] ?? b.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No answers yet">Subject lines that earn replies show up here.</Empty>
          )}
        </Section>
        <Section title="Deal angles">
          {d.angles.length ? (
            <table className="w-full text-left text-[14px]">
              <thead className="text-[13px] text-ink-3">
                <tr>
                  <th className="pb-2 font-normal">Angle</th>
                  <th className="pb-2 text-right font-normal">Pitched</th>
                  <th className="pb-2 text-right font-normal">Positive replies</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.angles.map((a) => (
                  <tr key={a.type}>
                    <td className="py-2 capitalize">{a.type}</td>
                    <td className="py-2 text-right tabular-nums">{a.targets}</td>
                    <td className="py-2 text-right tabular-nums">{a.replied}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty title="Nothing sent yet">Once emails go out, you can see which deal types get positive replies.</Empty>
          )}
        </Section>
      </div>
    </div>
  );
}

function Heatmap({ byDay }: { byDay: { d: string; n: number }[] }) {
  const [hover, setHover] = useState<{ d: string; n: number } | null>(null);
  const { weeks, max } = useMemo(() => {
    const map = new Map(byDay.map((x) => [x.d, x.n]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - 83 - ((start.getDay() + 6) % 7)); // align to Monday
    const weeks: { d: string; n: number; future: boolean }[][] = [];
    for (let w = 0; w < 13; w++) {
      const col = [];
      for (let i = 0; i < 7; i++) {
        const dt = new Date(start);
        dt.setDate(start.getDate() + w * 7 + i);
        const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
        col.push({ d: key, n: map.get(key) ?? 0, future: dt > today });
      }
      weeks.push(col);
    }
    return { weeks, max: Math.max(1, ...byDay.map((x) => x.n)) };
  }, [byDay]);
  const step = (n: number) => (n === 0 ? 0 : Math.min(5, 1 + Math.floor(((n - 1) / max) * 5)));
  const total = byDay.reduce((a, b) => a + b.n, 0);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-[32px] tracking-[-0.04em]">{total}</p>
        <p className="h-5 text-[13px] text-ink-3" aria-live="polite">
          {hover ? `${new Date(hover.d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${hover.n} sent` : 'Hover a day'}
        </p>
      </div>
      <div className="mt-4 flex gap-[3px] overflow-x-auto pb-1" role="grid" aria-label="Emails sent per day">
        <div className="mr-1 grid grid-rows-7 gap-[3px] text-[11px] text-ink-3" aria-hidden>
          {['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((l, i) => (
            <span key={i} className="flex h-[18px] items-center">
              {l}
            </span>
          ))}
        </div>
        {weeks.map((col, w) => (
          <div key={w} role="row" className="grid grid-rows-7 gap-[3px]">
            {col.map((c) => (
              <span
                key={c.d}
                role="gridcell"
                tabIndex={c.future ? -1 : 0}
                aria-label={`${c.d}: ${c.n} sent`}
                onMouseEnter={() => setHover(c)}
                onFocus={() => setHover(c)}
                onMouseLeave={() => setHover(null)}
                className={cx('size-[18px] rounded-[3px] transition-transform duration-150 hover:scale-110', c.future && 'opacity-30')}
                style={{ background: RAMP[step(c.n)] }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-3">
        Fewer
        {RAMP.map((c) => (
          <span key={c} className="size-3 rounded-[2px]" style={{ background: c }} />
        ))}
        More
      </div>
    </div>
  );
}

function WarmCold({ rows }: { rows: { k: string; sent: number; replied: number }[] }) {
  const get = (k: string) => rows.find((r) => r.k === k) ?? { k, sent: 0, replied: 0 };
  const data = [get('warm'), get('cold')];
  if (!data.some((d) => d.sent)) return <Empty title="Nothing sent yet">Referrals usually reply far more often. This shows whether that holds for you.</Empty>;
  return (
    <div className="grid gap-5">
      {data.map((d) => {
        const rate = d.sent ? d.replied / d.sent : 0;
        return (
          <div key={d.k}>
            <div className="flex items-baseline justify-between text-[14px]">
              <span className="font-medium capitalize">{d.k}</span>
              <span className="text-ink-3">
                <span className="text-[20px] tracking-[-0.03em] text-ink">{Math.round(rate * 100)}%</span> · {d.replied}/{d.sent} replied
              </span>
            </div>
            <div className="mt-2 h-3 overflow-hidden rounded-[3px] bg-ground-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
              <motion.div className="h-full rounded-[3px] bg-moss" initial={{ width: 0 }} animate={{ width: `${rate * 100}%` }} transition={{ duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
