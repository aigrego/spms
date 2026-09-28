'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useT } from '@/lib/i18n';
import { inputCls as baseInputCls } from '@/components/common';

/* Shared bits for the /platform admin pages (kept out of components/ui —
   these are platform-specific compositions, not generic primitives). */

// 通用表单样式常量的唯一定义在 @/components/common;此处转出口供 platform 各
// 面板沿用现有 import 路径。
export { fieldLabel, inputCls } from '@/components/common';

/* 原生 select 的样式化 chevron(gitea/main 移植):基于共享 inputCls。 */
export const selectCls = `${baseInputCls} select-chevron`;

/* Page header — mirrors the ViewHeader pattern in @/components/common. */
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
  confirmLabel,
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
  const t = useT();
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-[240px] p-3" align="end">
        <div className="mb-1 text-[13px] font-semibold text-fg-1">{title}</div>
        {body && <p className="mb-2 mt-0 text-[12px] leading-relaxed text-fg-3">{body}</p>}
        <div className="mt-2 flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            {t('common.cancel')}
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
            {confirmLabel ?? t('platform.common.confirm')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const thCls =
  'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-fg-3 first:pl-6 last:pr-6';
export const tdCls = 'px-3 py-2.5 text-[13px] text-fg-1 first:pl-6 last:pr-6';

/* Null-safe absolute date: 2026/7/21。新代码优先用 lib/time 的
   formatDate(iso, locale)(locale-aware);本函数服务于无 locale 上下文的调用方。 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
