'use client';

import * as React from 'react';

/* Pill segmented control button (filters). Selected uses the tint-not-fill
   raised-surface treatment, never a solid color. */
export function SegBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-[3px] text-[12px] font-medium transition-colors"
      style={{
        background: active ? 'var(--surface)' : 'transparent',
        boxShadow: active ? 'var(--shadow-1)' : 'none',
        color: active ? 'var(--fg-1)' : 'var(--fg-3)',
      }}
    >
      {children}
    </button>
  );
}

/* Underline tab (primary section split, e.g. functional / non-functional). */
export function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="relative -mb-px inline-flex items-center gap-1.5 border-b-2 px-1 pb-2 text-[13.5px] font-semibold transition-colors"
      style={{ borderColor: active ? 'var(--brand-blue)' : 'transparent', color: active ? 'var(--fg-1)' : 'var(--fg-3)' }}
    >
      {children}
    </button>
  );
}
