'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type Tone = 'blue' | 'orange' | 'success' | 'warning' | 'danger' | 'neutral' | 'purple';

const tones: Record<Tone, { bg: string; color: string; dot: string }> = {
  blue: { bg: 'var(--xgent-blue-50)', color: '#003E85', dot: 'var(--brand-blue)' },
  orange: { bg: 'var(--xgent-orange-50)', color: '#7A3300', dot: 'var(--brand-orange)' },
  success: { bg: 'var(--success-50)', color: '#15683A', dot: 'var(--success-500)' },
  warning: { bg: 'var(--warning-50)', color: '#7A5300', dot: 'var(--warning-500)' },
  danger: { bg: 'var(--danger-50)', color: '#8C1B28', dot: 'var(--danger-500)' },
  neutral: { bg: 'var(--surface-2)', color: 'var(--fg-2)', dot: 'var(--slate-500)' },
  purple: { bg: '#EFE9FB', color: '#5B3FA8', dot: '#7A5AE0' },
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
}

export function Badge({ tone = 'neutral', dot, className, children, style, ...props }: BadgeProps) {
  const t = tones[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-normal whitespace-nowrap',
        className,
      )}
      style={{ background: t.bg, color: t.color, ...style }}
      {...props}
    >
      {dot && (
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.dot }} />
      )}
      {children}
    </span>
  );
}
