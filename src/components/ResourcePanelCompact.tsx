'use client';

import * as React from 'react';
import { Avatar } from '@/components/glyphs/Avatar';
import { useNodeAssignments } from '@/store/resources';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { AssignmentNodeType } from '@/lib/types';

/* Phase C2 placeholder for the full ResourcePanel (ported in Phase C3, which
   will overwrite this file): renders only the compact avatar stack of a node's
   研发资源 (virtual team) assignments — no assigner popover, no invite flow.
   Props mirror the original spms-app panel (`variant`; `mode` is accepted as
   an alias per the C2 brief) so call sites survive the C3 swap unchanged. */
export function ResourcePanelCompact({
  nodeType,
  nodeId,
  variant = 'compact',
  mode,
  className,
}: {
  nodeType: AssignmentNodeType;
  nodeId: string;
  variant?: 'compact' | 'full';
  mode?: 'compact' | 'full';
  className?: string;
}) {
  const t = useT();
  const { data: rows = [] } = useNodeAssignments(nodeType, nodeId);
  // lead first, keep relative order otherwise (mirrors ResourcePanel's leadFirst)
  const sorted = React.useMemo(
    () => [...rows].sort((a, b) => (a.role === b.role ? 0 : a.role === 'lead' ? -1 : 1)),
    [rows],
  );
  // compact-only placeholder — `full` mode arrives with C3's ResourcePanel
  void variant;
  void mode;

  return (
    <div className={cn('flex items-center', className)} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center">
        {sorted.slice(0, 5).map((r, i) => (
          <span
            key={r.id}
            title={`${r.member?.name ?? ''}${r.role === 'lead' ? ' · ' + t('team.lead') : ''}${
              r.source === 'propagated' ? ' · ' + t('team.propagated') : ''
            }`}
            className="rounded-full"
            style={{
              marginLeft: i === 0 ? 0 : -6,
              opacity: r.source === 'propagated' ? 0.5 : 1,
              boxShadow: '0 0 0 2px var(--surface)',
            }}
          >
            <Avatar person={r.member} size={22} ring={r.role === 'lead'} />
          </span>
        ))}
        {sorted.length > 5 && (
          <span className="ml-1 text-[11px] font-medium text-fg-3">+{sorted.length - 5}</span>
        )}
      </div>
    </div>
  );
}
