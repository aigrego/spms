'use client';

import { Inbox, AlertTriangle, Lock, type LucideIcon } from 'lucide-react';

type Tone = 'neutral' | 'danger' | 'forbidden';

const TONES: Record<Tone, { fg: string; bg: string }> = {
  neutral: { fg: 'var(--fg-3)', bg: 'var(--surface-2)' },
  danger: { fg: 'var(--danger-500)', bg: 'var(--danger-50)' },
  forbidden: { fg: 'var(--warning-500)', bg: 'var(--warning-50)' },
};

const ICONS: Record<string, LucideIcon> = { inbox: Inbox, alert: AlertTriangle, lock: Lock };

/* Empty / error / forbidden state. Centered, calm, with an optional action.
   (PLAN-5 §5.2 — the shared spms-app StateBlock, mirrors files-app.) */
export function StateBlock({
  icon = 'inbox',
  tone = 'neutral',
  title,
  body,
  action,
}: {
  icon?: 'inbox' | 'alert' | 'lock';
  tone?: Tone;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  const Ic = ICONS[icon] ?? Inbox;
  const c = TONES[tone];
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="flex max-w-[360px] flex-col items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: c.bg }}>
          <Ic size={22} style={{ color: c.fg }} />
        </span>
        <div className="text-[15px] font-semibold text-fg-1">{title}</div>
        {body && <p className="m-0 text-[13px] leading-relaxed text-fg-3">{body}</p>}
        {action}
      </div>
    </div>
  );
}

/* Loading skeleton — a stack of shimmering rows (respects reduced-motion via CSS). */
export function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2.5 p-5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-[42px] rounded-lg" style={{ opacity: 1 - i * 0.04 }} />
      ))}
    </div>
  );
}
