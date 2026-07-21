'use client';

import * as React from 'react';
import { Crown, UserPlus } from 'lucide-react';
import { Avatar } from '@/components/glyphs/Avatar';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useNodeAssignments, useAssignCandidates, useAssign, useUnassign, useSetAssignmentRole } from '@/store/resources';
import { useAppData } from '@/store/AppData';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { AssignmentNodeType } from '@/lib/types';

/* Compact virtual-team panel: the avatar stack of a node's 研发资源
   assignments (lead first, propagated at 50% opacity) plus, for users with
   resources write permission, a + assigner popover (assign / unassign /
   toggle lead). Propagated rows can't be removed here — the service rejects
   them; remove at the source (child) node instead. */
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
  const { can } = useAppData();
  const canWrite = can('resources', 'write');
  const { data: rows = [] } = useNodeAssignments(nodeType, nodeId);
  // lead first, keep relative order otherwise (mirrors ResourcePanel's leadFirst)
  const sorted = React.useMemo(
    () => [...rows].sort((a, b) => (a.role === b.role ? 0 : a.role === 'lead' ? -1 : 1)),
    [rows],
  );
  // compact-only panel — `full` mode arrives with C3's ResourcePanel
  void variant;
  void mode;

  const [open, setOpen] = React.useState(false);
  const { data: candidates } = useAssignCandidates(nodeType, nodeId, open);
  const assign = useAssign();
  const unassign = useUnassign();
  const setRole = useSetAssignmentRole();
  const busy = assign.isPending || unassign.isPending || setRole.isPending;

  const rowByMember = React.useMemo(() => new Map(rows.map((r) => [r.memberId, r])), [rows]);

  const toggle = (memberId: string) => {
    if (busy) return;
    const row = rowByMember.get(memberId);
    if (!row) {
      assign.mutate({ nodeType, nodeId, memberId });
    } else if (row.source !== 'propagated') {
      unassign.mutate({ nodeType, nodeId, memberId });
    }
  };

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
      {canWrite && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              title={t('team.assign')}
              className="ml-1.5 grid h-[22px] w-[22px] place-items-center rounded-full border border-dashed border-border-strong text-fg-3 hover:border-brand-blue hover:text-brand-blue"
            >
              <UserPlus size={12} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            style={{ width: 264 }}
            onClick={(e) => e.stopPropagation()}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
              {t('team.assign')}
            </div>
            {(candidates?.candidates ?? []).map((m) => {
              const row = rowByMember.get(m.id);
              const propagated = row?.source === 'propagated';
              return (
                <div
                  key={m.id}
                  onClick={() => !propagated && toggle(m.id)}
                  title={propagated ? t('team.propagatedHint') : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-fg-1',
                    propagated ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-surface-2',
                  )}
                >
                  <Avatar person={m} size={20} ring={row?.role === 'lead'} />
                  <span className="flex-1 truncate">{m.name}</span>
                  {propagated && <span className="text-[11px] text-fg-3">{t('team.propagated')}</span>}
                  {row && !propagated && (
                    <button
                      title={row.role === 'lead' ? t('team.unsetLead') : t('team.setLead')}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!busy) setRole.mutate({ id: row.id, role: row.role === 'lead' ? 'member' : 'lead' });
                      }}
                      className={cn(
                        'grid h-5 w-5 place-items-center rounded',
                        row.role === 'lead' ? 'text-brand-orange' : 'text-fg-3 hover:text-brand-orange',
                      )}
                    >
                      <Crown size={13} />
                    </button>
                  )}
                  {row && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              );
            })}
            {candidates && candidates.candidates.length === 0 && (
              <div className="px-2.5 py-2 text-[12.5px] text-fg-3">{t('team.empty')}</div>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
