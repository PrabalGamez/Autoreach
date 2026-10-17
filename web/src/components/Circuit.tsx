import { AtSign, Briefcase, Lightbulb, Mail, Radio, Send, Sparkles, Handshake } from 'lucide-react';
import type { ComponentType } from 'react';
import { cx } from './ui.tsx';

/**
 * The template's circuit-board ground: thin routed traces with small labelled nodes.
 * Coordinates are in a 1000x1000 box stretched to the container; strokes stay 1px.
 */
const TRACES = [
  'M0 120 H140 Q160 120 160 140 V260 Q160 280 180 280 H300',
  'M0 420 H70 Q90 420 90 440 V560 Q90 580 110 580 H230 Q250 580 250 600 V720',
  'M0 860 H120 Q140 860 140 840 V780',
  'M300 0 V40 Q300 60 320 60 H420',
  'M1000 90 H880 Q860 90 860 110 V200 Q860 220 840 220 H760',
  'M1000 380 H930 Q910 380 910 400 V520 Q910 540 890 540 H800 Q780 540 780 560 V660',
  'M1000 760 H900 Q880 760 880 780 V1000',
  'M640 0 V30 Q640 50 660 50 H760',
  'M420 1000 V940 Q420 920 440 920 H560',
];
const PULSES = [0, 4, 5];

// Nodes sit on the traces, near the edges, so they never collide with content.
const NODES: { x: number; y: number; Icon: ComponentType<{ className?: string }> }[] = [
  { x: 7, y: 12, Icon: Mail },
  { x: 3.5, y: 42, Icon: Briefcase },
  { x: 6, y: 86, Icon: Lightbulb },
  { x: 94, y: 9, Icon: Send },
  { x: 96, y: 38, Icon: Radio },
  { x: 88, y: 90, Icon: AtSign },
  { x: 71, y: 5, Icon: Sparkles },
  { x: 42, y: 96.5, Icon: Handshake },
];

export function Circuit({ dark = false, className, nodes = true }: { dark?: boolean; className?: string; nodes?: boolean }) {
  const stroke = dark ? '#ffffff1f' : 'var(--color-line)';
  return (
    <div aria-hidden className={cx('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <svg className="absolute inset-0 size-full" viewBox="0 0 1000 1000" preserveAspectRatio="none" fill="none">
        {TRACES.map((d, i) => (
          <path key={i} d={d} stroke={stroke} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {PULSES.map((i) => (
          <path key={`p${i}`} d={TRACES[i]} stroke={dark ? '#ecebe199' : '#2f564099'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" pathLength={100} strokeDasharray="6 94" className="animate-[trace_7s_linear_infinite] motion-reduce:hidden" style={{ animationDelay: `${i * -1.7}s` }} />
        ))}
      </svg>
      {nodes &&
        NODES.map(({ x, y, Icon }, i) => (
          <span
            key={i}
            className={cx('absolute hidden h-6 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[4px] md:grid', dark ? 'bg-forest-3 text-cream/60 shadow-[0_0_0_1px_#ffffff1a]' : 'bg-ground-2 text-ink-3 shadow-[0_0_0_1px_var(--color-line)]')}
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <Icon className="size-3" />
          </span>
        ))}
      <style>{`@keyframes trace { from { stroke-dashoffset: 100 } to { stroke-dashoffset: 0 } }`}</style>
    </div>
  );
}
