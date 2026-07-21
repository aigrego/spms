'use client';

import { Sparkles, Zap, Eye, Box, Target, Activity, X, type LucideIcon } from 'lucide-react';
import type { Label } from '@/lib/types';

/* AI badge shown on issues handled by an agent. */
export function AISlaBadge() {
  return (
    <span
      className="inline-flex flex-none items-center gap-0.5 rounded-full px-1.5 py-px text-[10.5px] font-semibold"
      style={{ background: 'var(--xgent-orange-50)', color: 'var(--brand-orange)' }}
    >
      <Sparkles size={10} /> AI
    </span>
  );
}

const PROJECT_ICONS: Record<string, LucideIcon> = {
  zap: Zap,
  eye: Eye,
  box: Box,
  target: Target,
  activity: Activity,
};

export function ProjectIcon({
  name,
  size = 16,
  color = '#fff',
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  const Comp = PROJECT_ICONS[name] ?? Box;
  return <Comp size={size} color={color} />;
}

/* Colored-dot label chip, Linear-style. */
export function LabelChip({ label, onRemove }: { label: Label; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface py-0.5 pl-[7px] pr-[9px] text-[11.5px] font-medium text-fg-2">
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: label.color }} />
      {label.name}
      {onRemove && (
        <X size={11} className="ml-px cursor-pointer text-fg-3" onClick={onRemove} />
      )}
    </span>
  );
}
