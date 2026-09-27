'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/* App-wide shared bits (parallel to platform/common.tsx, which re-exports the
   form constants below for its existing consumers). */

export const fieldLabel = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-3';
export const inputCls =
  'h-9 w-full rounded-lg border border-border-strong bg-surface px-2.5 text-[13px] text-fg-1 outline-none focus:border-brand-blue';

/* Page header: title + optional count chip + right-side action area.
   - default: own bottom border (standalone page header);
   - bordered={false}: first row of a two-row toolbar (the wrapper owns the
     border above the filter row);
   - subtitle: secondary line under the title (全部 Issues);
   - extra: inline node after the count chip, before the right actions
     (产品/资源页的副标题)。 */
export function ViewHeader({
  title,
  count,
  subtitle,
  extra,
  bordered = true,
  className,
  children,
}: {
  title: string;
  count?: number;
  subtitle?: React.ReactNode;
  extra?: React.ReactNode;
  bordered?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const chip = count != null && (
    <span className="rounded-full bg-surface-2 px-2.5 py-px text-[12.5px] font-semibold text-fg-3">{count}</span>
  );
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-6',
        bordered ? 'border-b border-border py-3.5' : 'pb-3 pt-3.5',
        className,
      )}
    >
      {subtitle ? (
        <div className="flex-1">
          <div className="flex items-center gap-2.5">
            <h1 className="m-0 text-[18px] font-semibold tracking-tight text-fg-1">{title}</h1>
            {chip}
          </div>
          <div className="mt-0.5 text-[12.5px] text-fg-3">{subtitle}</div>
        </div>
      ) : (
        <>
          <h1 className="m-0 text-[18px] font-semibold tracking-tight text-fg-1">{title}</h1>
          {chip}
          {extra}
          <div className="flex-1" />
        </>
      )}
      {children}
    </div>
  );
}
