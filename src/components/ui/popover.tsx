'use client';

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        // z above the modal dialog layer (overlay 2000 / content 2001) so menus
        // opened from inside a Dialog (e.g. the New Issue form) render in front of
        // its dim overlay instead of behind it — otherwise the options look "dead".
        'z-[2100] max-h-[60vh] overflow-y-auto rounded-[10px] border border-border bg-surface p-1.5 shadow-3 outline-none data-[state=open]:animate-popIn',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

/* Shared menu item used across status/priority/assignee popovers. */
export function MenuItem({
  glyph,
  label,
  meta,
  selected,
  onClick,
}: {
  glyph?: React.ReactNode;
  label: React.ReactNode;
  meta?: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-fg-1 hover:bg-surface-2"
    >
      {glyph}
      <span className="flex-1 truncate">{label}</span>
      {meta && <span className="text-[11px] text-fg-3">{meta}</span>}
      {selected && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </div>
  );
}

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };
