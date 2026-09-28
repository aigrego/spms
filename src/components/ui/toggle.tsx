'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/* 偏好开关:传了 onToggle 即可点击;否则为占位的禁用态("即将上线"
   tooltip 由外层 span 提供 —— disabled 按钮不触发事件)。 */
export function Toggle({ on, disabledTitle, onToggle }: { on: boolean; disabledTitle?: string; onToggle?: () => void }) {
  return (
    <span title={disabledTitle} className="inline-flex">
      <button
        type="button"
        disabled={!!disabledTitle}
        onClick={onToggle}
        className={cn(
          'relative h-[22px] w-[40px] flex-none rounded-full transition-colors disabled:cursor-not-allowed',
          on ? 'bg-brand-blue' : 'bg-surface-sunken',
        )}
        style={{ border: '1px solid var(--border-strong)' }}
      >
        <span
          className="absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white transition-all"
          style={{ left: on ? 19 : 2, boxShadow: 'var(--shadow-1)' }}
        />
      </button>
    </span>
  );
}
