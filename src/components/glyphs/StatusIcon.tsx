'use client';

import { STATUS } from '@/lib/constants';
import type { IssueStatus } from '@/lib/types';

export function StatusIcon({ status, size = 16 }: { status: IssueStatus; size?: number }) {
  const c = STATUS[status]?.color ?? '#8E99B0';
  const r = 7;
  const cx = 12;
  const cy = 12;
  const circ = 2 * Math.PI * r;
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    style: { display: 'block', flex: 'none' as const },
  };

  if (status === 'done') {
    return (
      <svg {...common}>
        <circle cx={cx} cy={cy} r={9} fill={c} />
        <polyline
          points="8.5 12 11 14.5 15.5 9.5"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (status === 'canceled') {
    return (
      <svg {...common}>
        <circle cx={cx} cy={cy} r={9} fill={c} />
        <line x1="9" y1="9" x2="15" y2="15" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        <line x1="15" y1="9" x2="9" y2="15" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  const fill = ({ backlog: 0, todo: 0, in_progress: 0.4, in_review: 0.75 } as Record<string, number>)[status] ?? 0;
  return (
    <svg {...common}>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={c}
        strokeWidth="2"
        strokeDasharray={status === 'backlog' ? '2 2.5' : undefined}
      />
      {fill > 0 && (
        <circle
          cx={cx}
          cy={cy}
          r={r / 2}
          fill="none"
          stroke={c}
          strokeWidth={r}
          strokeDasharray={`${(circ * fill) / 2} ${circ}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      )}
    </svg>
  );
}
