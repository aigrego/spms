'use client';

import type { IssuePriority } from '@/lib/types';

export function PriorityIcon({ priority, size = 16 }: { priority: IssuePriority; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    style: { display: 'block', flex: 'none' as const },
  };

  if (priority === 'urgent') {
    return (
      <svg {...common}>
        <rect x="1" y="1" width="14" height="14" rx="3" fill="var(--brand-orange)" />
        <rect x="7" y="3.5" width="2" height="6" rx="1" fill="#fff" />
        <rect x="7" y="11" width="2" height="2" rx="1" fill="#fff" />
      </svg>
    );
  }
  if (priority === 'none') {
    return (
      <svg {...common}>
        {[0, 1, 2].map((i) => (
          <rect key={i} x={1 + i * 5} y="11" width="3" height="3" rx="1" fill="var(--slate-300)" />
        ))}
      </svg>
    );
  }

  const lit = ({ high: 3, medium: 2, low: 1 } as Record<string, number>)[priority] ?? 0;
  const heights = [5, 8, 11];
  return (
    <svg {...common}>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={1 + i * 5}
          y={14 - heights[i]}
          width="3"
          height={heights[i]}
          rx="1"
          fill={i < lit ? 'var(--fg-2)' : 'var(--slate-300)'}
        />
      ))}
    </svg>
  );
}
