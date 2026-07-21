'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-[13px] text-fg-1 outline-none transition-colors placeholder:text-fg-3 focus-visible:border-brand-blue focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
