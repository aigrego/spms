'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/* Shared bits for the /platform admin pages (kept out of components/ui —
   these are platform-specific compositions, not generic primitives). */

export const fieldLabel = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-3';
export const inputCls =
  'h-9 w-full rounded-lg border border-border-strong bg-surface px-2.5 text-[13px] text-fg-1 outline-none focus:border-brand-blue';

/* Page header — mirrors the ViewHeader pattern in ProjectsView. */
export function PlatformHeader({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-6 py-3.5">
      <h1 className="m-0 text-[18px] font-semibold tracking-tight text-fg-1">{title}</h1>
      {count != null && (
        <span className="rounded-full bg-surface-2 px-2.5 py-px text-[12.5px] font-semibold text-fg-3">{count}</span>
      )}
      <div className="flex-1" />
      {children}
    </div>
  );
}

/* First-letter avatar for platform members (they don't carry the full Member
   shape the glyphs Avatar expects). */
export function LetterAvatar({ name, avatarUrl, size = 24 }: { name: string; avatarUrl?: string | null; size?: number }) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 外部 OAuth 头像，域名不固定，不适用 next/image
      <img
        src={avatarUrl}
        alt={name}
        width={size}
        height={size}
        className="flex-none rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="grid flex-none place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.46, background: 'var(--slate-500)' }}
    >
      {(name || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

/* Lightweight destructive-confirm popover (移除成员 / 吊销 Key). */
export function PopoverConfirm({
  trigger,
  title,
  body,
  confirmLabel = '确认',
  busy,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  body?: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-[240px] p-3" align="end">
        <div className="mb-1 text-[13px] font-semibold text-fg-1">{title}</div>
        {body && <p className="mb-2 mt-0 text-[12px] leading-relaxed text-fg-3">{body}</p>}
        <div className="mt-2 flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={() => {
              onConfirm();
              setOpen(false);
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* zh absolute date: 2026/7/21 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export const thCls =
  'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-fg-3 first:pl-6 last:pr-6';
export const tdCls = 'px-3 py-2.5 text-[13px] text-fg-1 first:pl-6 last:pr-6';
