'use client';

import * as React from 'react';
import { Plus, Crown, X, Search, UserPlus } from 'lucide-react';
import { Avatar } from '@/components/glyphs/Avatar';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { InviteResourceModal } from '@/components/InviteResourceModal';
import { useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';
import {
  useNodeAssignments,
  useAssignCandidates,
  useAssign,
  useUnassign,
  useSetAssignmentRole,
} from '@/store/resources';
import { cn } from '@/lib/utils';
import type { AssignmentNodeType, AssignmentRow, CandidateMember, Member } from '@/lib/types';

/* PMS-2 §6.2 — reusable per-node 研发资源 (virtual team) panel. `compact` renders
   an avatar group + add button (for cards/headers); `full` renders a labelled list
   distinguishing direct vs propagated assignments (for ProjectHub). Assigning a
   resource propagates up the lifecycle; propagated rows are read-only here and
   point back to their source node. */

function leadFirst(rows: AssignmentRow[]) {
  return [...rows].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'lead' ? -1 : 1;
    if (a.source !== b.source) return a.source === 'direct' ? -1 : 1;
    return (a.member?.name ?? '').localeCompare(b.member?.name ?? '');
  });
}

/* The "+" assigner: parent-pool quick picks first, then the rest of the pool. */
function Assigner({
  nodeType,
  nodeId,
  assignedById,
  onInvite,
}: {
  nodeType: AssignmentNodeType;
  nodeId: string;
  assignedById: Map<string, AssignmentRow>;
  onInvite: () => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const { data } = useAssignCandidates(nodeType, nodeId, open);
  const assign = useAssign();
  const unassign = useUnassign();

  const candidates = (data?.candidates ?? []).filter((c) =>
    q ? c.name.toLowerCase().includes(q.toLowerCase()) : true,
  );
  const parentPool = candidates.filter((c) => c.inParentPool && !c.assignedHere);
  const rest = candidates.filter((c) => !c.inParentPool && !c.assignedHere);
  const here = candidates.filter((c) => c.assignedHere);

  const toggle = (c: CandidateMember) => {
    if (c.assignedHere) {
      const row = assignedById.get(c.id);
      if (row && row.source === 'propagated') return; // can't remove a propagated row here
      unassign.mutate({ nodeType, nodeId, memberId: c.id });
    } else {
      assign.mutate({ nodeType, nodeId, memberId: c.id });
    }
  };

  const Row = ({ c }: { c: CandidateMember }) => {
    const row = assignedById.get(c.id);
    const propagated = c.assignedHere && row?.source === 'propagated';
    return (
      <button
        onClick={() => toggle(c)}
        disabled={propagated}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px]',
          propagated ? 'cursor-default opacity-55' : 'hover:bg-surface-2',
        )}
      >
        <Avatar person={c} size={22} />
        <span className="min-w-0 flex-1 truncate text-fg-1">{c.name}</span>
        {c.status === 'invited' && <span className="text-[10.5px] text-fg-3">{t('status.invited')}</span>}
        {propagated && <span className="text-[10.5px] text-fg-3">{t('team.propagated')}</span>}
        {c.assignedHere ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <Plus size={13} className="text-fg-3" />
        )}
      </button>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={t('team.assign')}
          className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full border border-dashed border-border-strong text-fg-3 transition-colors hover:border-brand-blue hover:text-brand-blue"
        >
          <Plus size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[268px] p-0">
        <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
          <Search size={13} className="text-fg-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('team.searchPlaceholder')}
            className="w-full bg-transparent text-[13px] text-fg-1 outline-none placeholder:text-fg-3"
          />
        </div>
        <div className="max-h-[280px] overflow-y-auto p-1.5">
          {parentPool.length > 0 && (
            <>
              <div className="px-2 pb-0.5 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-fg-3">
                {t('team.parentPool')}
              </div>
              {parentPool.map((c) => <Row key={c.id} c={c} />)}
            </>
          )}
          {rest.length > 0 && (
            <>
              <div className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-fg-3">
                {t('team.tenantPool')}
              </div>
              {rest.map((c) => <Row key={c.id} c={c} />)}
            </>
          )}
          {here.map((c) => <Row key={c.id} c={c} />)}
          {candidates.length === 0 && (
            <div className="px-2 py-3 text-center text-[12px] text-fg-3">{t('team.noCandidates')}</div>
          )}
        </div>
        <button
          onClick={() => {
            setOpen(false);
            onInvite();
          }}
          className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-[12.5px] font-medium text-brand-blue hover:bg-surface-2"
        >
          <UserPlus size={13} /> {t('team.inviteExternal')}
        </button>
      </PopoverContent>
    </Popover>
  );
}

export function ResourcePanel({
  nodeType,
  nodeId,
  variant = 'compact',
  className,
}: {
  nodeType: AssignmentNodeType;
  nodeId: string;
  variant?: 'compact' | 'full';
  className?: string;
}) {
  const t = useT();
  const { meId } = useAppData();
  const { data: rows = [] } = useNodeAssignments(nodeType, nodeId);
  const unassign = useUnassign();
  const setRole = useSetAssignmentRole();
  const [inviteOpen, setInviteOpen] = React.useState(false);

  const assignedById = React.useMemo(() => new Map(rows.map((r) => [r.memberId, r])), [rows]);
  const sorted = leadFirst(rows);

  const assigner = (
    <Assigner nodeType={nodeType} nodeId={nodeId} assignedById={assignedById} onInvite={() => setInviteOpen(true)} />
  );
  const invite = <InviteResourceModal open={inviteOpen} onOpenChange={setInviteOpen} />;

  if (variant === 'compact') {
    return (
      <div className={cn('flex items-center gap-1.5', className)} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          {sorted.slice(0, 5).map((r, i) => (
            <span
              key={r.id}
              title={`${r.member?.name ?? ''}${r.role === 'lead' ? ' · ' + t('team.lead') : ''}${r.source === 'propagated' ? ' · ' + t('team.propagated') : ''}`}
              className="rounded-full"
              style={{ marginLeft: i === 0 ? 0 : -6, opacity: r.source === 'propagated' ? 0.5 : 1, boxShadow: '0 0 0 2px var(--surface)' }}
            >
              <Avatar person={r.member as Member} size={22} ring={r.role === 'lead'} />
            </span>
          ))}
          {sorted.length > 5 && (
            <span className="ml-1 text-[11px] font-medium text-fg-3">+{sorted.length - 5}</span>
          )}
        </div>
        {assigner}
        {invite}
      </div>
    );
  }

  // full
  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-3">{t('team.resources')}</span>
        <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-semibold text-fg-3">{rows.length}</span>
        <div className="flex-1" />
        {assigner}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-border px-3 py-4 text-center text-[12.5px] text-fg-3">
          {t('team.empty')}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border overflow-hidden rounded-[10px] border border-border">
          {sorted.map((r) => {
            const propagated = r.source === 'propagated';
            const you = r.memberId === meId;
            return (
              <div key={r.id} className="group flex items-center gap-2.5 bg-surface px-2.5 py-1.5">
                <span style={{ opacity: propagated ? 0.55 : 1 }}>
                  <Avatar person={r.member as Member} size={24} ring={r.role === 'lead'} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-fg-1">{r.member?.name ?? '—'}</span>
                    {you && <span className="text-[10.5px] text-fg-3">· {t('resources.you')}</span>}
                  </div>
                </div>
                {r.role === 'lead' && (
                  <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ background: 'var(--brand-blue-tint-8)', color: 'var(--brand-blue)' }}>
                    <Crown size={11} /> {t('team.lead')}
                  </span>
                )}
                {propagated ? (
                  <span title={t('team.propagatedHint')} className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium text-fg-3">
                    {t('team.propagated')}
                  </span>
                ) : (
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => setRole.mutate({ id: r.id, role: r.role === 'lead' ? 'member' : 'lead' })}
                      title={r.role === 'lead' ? t('team.unsetLead') : t('team.setLead')}
                      className="hover-surface grid h-6 w-6 place-items-center rounded-md text-fg-3 hover:text-brand-blue"
                    >
                      <Crown size={12} />
                    </button>
                    <button
                      onClick={() => unassign.mutate({ nodeType, nodeId, memberId: r.memberId })}
                      title={t('team.remove')}
                      className="hover-surface grid h-6 w-6 place-items-center rounded-md text-fg-3 hover:text-danger"
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {invite}
    </div>
  );
}
