'use client';

import * as React from 'react';
import { IMPORTANCE } from '@/lib/constants';
import type { Importance } from '@/lib/types';

/* 重要度 (impact) glyph — a diamond filled bottom-up by magnitude and colored by
   severity. Deliberately distinct from PriorityIcon's signal bars so the two
   metrics never read as the same control. `none` is a hollow outline. */
const FRACTION: Record<Importance, number> = {
  critical: 1,
  high: 0.72,
  medium: 0.5,
  low: 0.28,
  none: 0,
};

// Diamond spans y ∈ [1.5, 14.5] on a 16×16 box (height 13).
const TOP = 1.5;
const BOTTOM = 14.5;
const HEIGHT = BOTTOM - TOP;

export function ImportanceIcon({ importance, size = 16 }: { importance: Importance; size?: number }) {
  const id = React.useId().replace(/:/g, '');
  const frac = FRACTION[importance];
  const color = IMPORTANCE[importance].color;
  const fillY = BOTTOM - frac * HEIGHT;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      style={{ display: 'block', flex: 'none' }}
      aria-hidden
    >
      <clipPath id={`imp-${id}`}>
        <path d="M8 1.5 L14.5 8 L8 14.5 L1.5 8 Z" />
      </clipPath>
      {/* faint base so the diamond silhouette always reads */}
      <path
        d="M8 1.5 L14.5 8 L8 14.5 L1.5 8 Z"
        fill="none"
        stroke={importance === 'none' ? 'var(--slate-300)' : color}
        strokeWidth="1.4"
        strokeLinejoin="round"
        opacity={importance === 'none' ? 1 : 0.9}
      />
      {frac > 0 && (
        <rect x="0" y={fillY} width="16" height={HEIGHT} fill={color} clipPath={`url(#imp-${id})`} />
      )}
    </svg>
  );
}
