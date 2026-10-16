import { createContext, forwardRef, useCallback, useContext, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, X } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------- Mark & logo ----------
export function Mark({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={cx('inline-grid place-items-center rounded-[4px] bg-ink text-cream', className)} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 20 20" width={size * 0.62} height={size * 0.62} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 15 15 5M8 5h7v7" />
      </svg>
    </span>
  );
}

export function LogoPill({ onClick }: { onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex h-9 w-fit items-center gap-2 rounded-[4px] bg-paper pl-1.5 pr-3 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.08)] transition-transform duration-150 active:scale-[0.98]" aria-label="Autoreach home">
      <Mark size={24} />
      <span className="text-[15px] font-medium tracking-[-0.02em]">autoreach.</span>
    </button>
  );
}

// ---------- Buttons ----------
type Variant = 'primary' | 'light' | 'dark' | 'ghost' | 'danger' | 'ember' | 'onDark' | 'subtle';
const variants: Record<Variant, string> = {
  primary: 'bg-moss text-cream shadow-[var(--shadow-btn)] hover:bg-moss-2',
  light: 'bg-paper text-ink shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.08)] hover:bg-ground-2',
  dark: 'bg-forest text-cream shadow-[var(--shadow-btn)] hover:bg-forest-3',
  ghost: 'bg-transparent text-ink-2 hover:bg-black/5',
  danger: 'bg-alarm text-white shadow-[var(--shadow-btn)] hover:brightness-95',
  ember: 'bg-ember text-white shadow-[var(--shadow-btn)] hover:brightness-95',
  onDark: 'bg-transparent text-cream hover:bg-white/10',
  subtle: 'bg-white/10 text-cream hover:bg-white/15',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; busy?: boolean; icon?: ReactNode }>(
  function Button({ variant = 'primary', size = 'md', busy, icon, className, children, disabled, ...rest }, ref) {
    const sizes = { sm: 'h-8 px-3 text-[13px] gap-1.5', md: 'h-10 px-4 text-[14px] gap-2', lg: 'h-12 px-5 text-[15px] gap-2' };
    return (
      <button
        ref={ref}
        disabled={disabled || busy}
        className={cx(
          'inline-flex select-none items-center justify-center whitespace-nowrap rounded-[4px] font-medium transition-[background-color,transform,filter] duration-150 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100',
          variants[variant],
          sizes[size],
          className,
        )}
        {...rest}
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
        {children}
      </button>
    );
  },
);

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button aria-label={label} title={label} className={cx('inline-grid size-11 place-items-center rounded-[4px] text-ink-2 transition-colors duration-150 hover:bg-black/5', className)} {...rest}>
      {children}
    </button>
  );
}

// ---------- Type ----------
export function TwoTone({ a, b, as: As = 'h1', className }: { a: ReactNode; b?: ReactNode; as?: 'h1' | 'h2' | 'h3' | 'p'; className?: string }) {
  return (
    <As className={cx('headline', className)}>
      <span className="text-ink">{a}</span>
      {b ? (
        <>
          {' '}
          <span className="text-hush">{b}</span>
        </>
      ) : null}
    </As>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

// ---------- Badges ----------
export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'warm' | 'good' | 'bad' | 'dark' | 'form'; children: ReactNode; className?: string }) {
  const tones = {
    neutral: 'bg-ground-2 text-ink-2 shadow-[0_0_0_1px_var(--color-line)]',
    warm: 'bg-ember text-white',
    good: 'bg-leaf/15 text-[#235a36]',
    bad: 'bg-alarm/12 text-[#8e2626]',
    dark: 'bg-white/10 text-cream',
    form: 'bg-sun text-[#3d3005]',
  };
  return <span className={cx('inline-flex h-6 items-center gap-1 rounded-[3px] px-2 text-[12px] font-medium', tones[tone], className)}>{children}</span>;
}

// ---------- Form fields ----------
export function Label({ htmlFor, children, hint }: { htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[14px] font-medium text-ink-2">
      {children}
      {hint ? <span className="ml-2 font-normal text-ink-3">{hint}</span> : null}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx('field', className)} {...rest} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx('field min-h-28 resize-y leading-relaxed', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx('field appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 fill=%27none%27 stroke=%27%235E5752%27 stroke-width=%272%27%3E%3Cpath d=%27m3 4.5 3 3 3-3%27/%3E%3C/svg%3E")] bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-9', className)} {...rest}>
      {children}
    </select>
  );
}

export function Toggle({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button id={id} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-moss' : 'bg-line-strong')}>
      <span className={cx('absolute top-0.5 size-5 rounded-full bg-paper shadow transition-transform duration-200', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-4 animate-spin', className)} aria-label="Loading" />;
}

// ---------- Toasts ----------
interface ToastItem {
  id: number;
  tone: 'info' | 'error' | 'good';
  text: string;
}
const ToastCtx = createContext<(text: string, tone?: ToastItem['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: ToastItem['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, tone, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] flex w-[min(92vw,440px)] -translate-x-1/2 flex-col gap-2" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
              className={cx('pointer-events-auto flex items-start gap-3 rounded-[6px] px-4 py-3 text-[14px] shadow-[var(--shadow-dark)]', t.tone === 'error' ? 'bg-alarm text-white' : 'bg-forest text-cream')}
              role={t.tone === 'error' ? 'alert' : 'status'}
            >
              <span className="flex-1">{t.text}</span>
              <button aria-label="Dismiss" className="-m-1 p-1 opacity-70 hover:opacity-100" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}>
                <X className="size-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Layout bits ----------
export function Section({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('paper-card p-5 md:p-6', className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-medium tracking-[-0.02em]">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-[6px] bg-ground-2 px-6 py-14 text-center shadow-[inset_0_0_0_1px_var(--color-line)]">
      <Mark size={36} className="mb-4" />
      <p className="text-[18px] font-medium tracking-[-0.02em]">{title}</p>
      {children ? <p className="mt-1 max-w-md text-[15px] text-ink-3">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Monogram({ name, domain, size = 40, dark }: { name: string; domain?: string | null; size?: number; dark?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span className={cx('relative inline-grid shrink-0 place-items-center overflow-hidden rounded-[6px] text-[14px] font-medium', dark ? 'bg-white/10 text-cream' : 'bg-ground-2 text-ink-2 shadow-[0_0_0_1px_var(--color-line)]')} style={{ width: size, height: size }}>
      {initials}
      {domain && !failed && (
        <img
          src={`https://${domain}/favicon.ico`}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={(e) => (e.currentTarget.naturalWidth < 8 ? setFailed(true) : setLoaded(true))}
          onError={() => setFailed(true)}
          className={cx('absolute inset-0 m-auto rounded-[3px] p-[22%] transition-opacity duration-200', dark ? 'bg-forest-3' : 'bg-ground-2', loaded ? 'opacity-100' : 'opacity-0')}
          style={{ width: size, height: size }}
        />
      )}
    </span>
  );
}
