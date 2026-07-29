'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Target, GripVertical, ArrowRight, Flame, Gauge, ChevronRight, ChevronDown, Plus, Pencil, Play, CheckCircle2, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Popover, PopoverTrigger, PopoverContent, MenuItem } from '@/components/ui/popover';
import { StatusIcon } from '@/components/glyphs/StatusIcon';
import { PriorityIcon } from '@/components/glyphs/PriorityIcon';
import { Avatar } from '@/components/glyphs/Avatar';
import { AISlaBadge } from '@/components/glyphs/misc';
import { ResourcePanelCompact } from '@/components/ResourcePanelCompact';
import { Markdown } from '@/components/Markdown';
import { SprintModal, ConfirmDeleteSprint, useSprintDict } from '@/components/SprintModal';
import { SPRINT_STATUS } from '@/lib/constants';
import { useT } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import { useAppData } from '@/store/AppData';
import { useBacklog, useSprints, useSprint, useBurndown, useVelocity, useMoveIssueToSprint, useStartSprint, useCompleteSprint, useDeleteSprint } from '@/store/sprints';
import type { Issue, Sprint, Burndown, Velocity } from '@/lib/types';

/* Port of spms-app's ScrumViews.tsx (BacklogView + SprintsView). Differences
   vs the blueprint:
   - no `team` prop — the standalone app is single-workspace, hooks are called
     unscoped (same as C1's issues view);
   - ResourcePanel → ResourcePanelCompact placeholder until Phase C3 lands the
     full panel;
   - SprintsView gains a 新建迭代 entry + a card edit button wired to the new
     SprintModal (no blueprint counterpart). */

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */
export function ViewHeader({ title, count, children }: { title: string; count?: number; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-6 py-3.5">
      <h1 className="m-0 text-[18px] font-semibold tracking-tight text-fg-1">{title}</h1>
      {count != null && (
        <span className="rounded-full bg-surface-2 px-2.5 py-px text-[12.5px] font-semibold text-fg-3">{count}</span>
      )}
      <div className="flex-1" />
      {children}
    </div>
  );
}

function PointsChip({ points }: { points: number | null }) {
  if (points == null) return null;
  return (
    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-blue/10 px-1.5 text-[11px] font-semibold text-brand-blue">
      {points}
    </span>
  );
}

/* A compact, draggable backlog/sprint issue row. */
function ScrumIssueRow({
  issue,
  onOpen,
  onDragStart,
  draggable,
}: {
  issue: Issue;
  onOpen: (id: string) => void;
  onDragStart?: (e: React.DragEvent, id: string) => void;
  draggable?: boolean;
}) {
  const { memberById } = useAppData();
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(e, issue.id)}
      onClick={() => onOpen(issue.id)}
      className="group flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2 shadow-1 transition-shadow hover:shadow-2"
    >
      {draggable && (
        <GripVertical size={14} className="flex-none text-fg-3 opacity-0 group-hover:opacity-100" />
      )}
      <PriorityIcon priority={issue.priority} size={15} />
      <StatusIcon status={issue.status} size={15} />
      <span className="flex-none font-mono text-[11px] text-fg-3">{issue.id}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-fg-1">{issue.title}</span>
      {issue.aiAssigned && <AISlaBadge />}
      <PointsChip points={issue.storyPoints} />
      <Avatar person={memberById(issue.assigneeId)} size={20} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Burndown chart (SVG)                                                */
/* ------------------------------------------------------------------ */
function BurndownChart({ data }: { data: Burndown }) {
  const t = useT();
  const W = 560;
  const H = 220;
  const pad = { t: 16, r: 16, b: 28, l: 34 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const maxY = Math.max(data.committed, 1);
  const x = (day: number) => pad.l + (innerW * day) / data.totalDays;
  const y = (pts: number) => pad.t + innerH - (innerH * pts) / maxY;

  const idealPath = data.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.day)} ${y(p.ideal)}`).join(' ');
  const actualPts = data.points.filter((p) => p.actual !== null);
  const actualPath = actualPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.day)} ${y(p.actual as number)}`).join(' ');

  // y gridlines at 0, 25, 50, 75, 100% (去重:maxY 较小时相邻刻度取整后会相等)
  const ticks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxY * f)))];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 240 }}>
      {ticks.map((tv) => (
        <g key={tv}>
          <line x1={pad.l} y1={y(tv)} x2={W - pad.r} y2={y(tv)} stroke="var(--border)" strokeWidth="1" />
          <text x={pad.l - 6} y={y(tv) + 3} textAnchor="end" fontSize="9" fill="var(--fg-3)">
            {tv}
          </text>
        </g>
      ))}
      {/* x labels: day 0 and last */}
      <text x={x(0)} y={H - 8} textAnchor="start" fontSize="9" fill="var(--fg-3)">{t('scrum.day', { n: 1 })}</text>
      <text x={x(data.totalDays)} y={H - 8} textAnchor="end" fontSize="9" fill="var(--fg-3)">{t('scrum.day', { n: data.totalDays })}</text>
      {/* ideal (dashed) */}
      <path d={idealPath} fill="none" stroke="var(--fg-3)" strokeWidth="1.5" strokeDasharray="4 4" />
      {/* actual (solid orange) */}
      {actualPts.length > 1 && (
        <path d={actualPath} fill="none" stroke="var(--brand-orange)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      )}
      {actualPts.map((p) => (
        <circle key={p.day} cx={x(p.day)} cy={y(p.actual as number)} r="3" fill="var(--brand-orange)" />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Velocity chart (SVG bars)                                           */
/* ------------------------------------------------------------------ */
function VelocityChart({ data }: { data: Velocity }) {
  const t = useT();
  // 只画最近 8 个迭代:再多 svg 整体缩窄、柱子和标签都会糊;速度本身就是近期趋势。
  const series = data.series.slice(-8);
  if (!series.length) return null;
  const maxY = Math.max(...series.map((s) => Math.max(s.committed, s.completed)), 1);
  const barH = 120;
  const groupW = 64;
  const W = Math.max(series.length * groupW + 20, 200);
  // 9px 字号下 64px 组宽最多放 ~6 个汉字;先压缩常见英文命名(Sprint 12 → S12),
  // 仍超长再截断,全名走 <title> 悬停提示。
  const shortName = (name: string) => {
    const s = name.replace('Sprint ', 'S');
    return s.length > 6 ? `${s.slice(0, 6)}…` : s;
  };

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${barH + 28}`} className="w-full" style={{ maxHeight: 180 }}>
        {series.map((s, i) => {
          const cx = 10 + i * groupW + groupW / 2;
          const committedH = (barH * s.committed) / maxY;
          const completedH = (barH * s.completed) / maxY;
          return (
            <g key={s.sprintId}>
              {/* committed (light) */}
              <rect x={cx - 18} y={barH - committedH} width="16" height={committedH} rx="2" fill="var(--surface-sunken)" />
              {/* completed (blue) */}
              <rect x={cx + 2} y={barH - completedH} width="16" height={completedH} rx="2" fill="var(--brand-blue)" />
              <text x={cx} y={barH + 14} textAnchor="middle" fontSize="9" fill="var(--fg-3)">
                {shortName(s.name)}
                <title>{s.name}</title>
              </text>
              <text x={cx} y={barH + 25} textAnchor="middle" fontSize="9" fill="var(--fg-2)" fontWeight="600">
                {s.completed}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex items-center gap-4 px-2 text-[11px] text-fg-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--surface-sunken)' }} /> {t('scrum.committed')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-brand-blue" /> {t('scrum.completed')}
        </span>
        {data.avgVelocity != null && <span className="ml-auto">{t('scrum.avgVelocity', { n: data.avgVelocity })}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Backlog view (product backlog + sprint planning drop targets)       */
/* ------------------------------------------------------------------ */
export function BacklogView({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useT();
  const { data: backlog = [] } = useBacklog();
  const { data: sprints = [] } = useSprints();
  const move = useMoveIssueToSprint();
  const [dragOver, setDragOver] = React.useState<string | null>(null);

  const onDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/id', id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDrop = (sprintId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/id');
    if (id) move.mutate({ sprintId, issueId: id });
    setDragOver(null);
  };

  const backlogPoints = backlog.reduce((s, i) => s + (i.storyPoints ?? 0), 0);
  const planSprints = sprints.filter((s) => s.status !== 'completed');

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader title={t('scrum.backlogTitle')} count={backlog.length}>
        <Badge tone="neutral">{t('scrum.storyPoints', { n: backlogPoints })}</Badge>
      </ViewHeader>
      <div className="flex min-h-0 flex-1">
        {/* Backlog list */}
        <div className="flex min-w-0 flex-1 flex-col border-r border-border">
          <div className="px-6 py-2.5 text-[12px] text-fg-3">{t('scrum.dragHint')}</div>
          <div className="flex flex-col gap-2 overflow-y-auto px-6 pb-6">
            {backlog.map((i) => (
              <ScrumIssueRow key={i.id} issue={i} onOpen={onOpen} onDragStart={onDragStart} draggable />
            ))}
            {backlog.length === 0 && (
              <div className="grid h-32 place-items-center text-[13px] text-fg-3">{t('scrum.backlogEmpty')}</div>
            )}
          </div>
        </div>
        {/* Sprint drop targets */}
        <div className="flex w-[340px] flex-none flex-col gap-3 overflow-y-auto bg-surface-2/40 p-4">
          {planSprints.map((s) => {
            const st = SPRINT_STATUS[s.status];
            return (
              <div
                key={s.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(s.id);
                }}
                onDragLeave={() => setDragOver((d) => (d === s.id ? null : d))}
                onDrop={onDrop(s.id)}
                className="rounded-xl border border-border bg-surface p-3 transition-colors"
                style={
                  dragOver === s.id
                    ? { background: 'var(--brand-blue-tint-8)', outline: '2px dashed var(--brand-blue)' }
                    : undefined
                }
              >
                <div className="mb-1 flex items-center gap-2">
                  <Target size={15} className="text-brand-blue" />
                  <span className="text-[13.5px] font-semibold text-fg-1">{s.name}</span>
                  <Badge tone={st.tone} dot>
                    {t(`sprintStatus.${s.status}`)}
                  </Badge>
                </div>
                {s.goal && <div className="mb-2 text-[12px] leading-snug text-fg-3">{s.goal}</div>}
                <div className="flex items-center gap-1.5 text-[11.5px] text-fg-3">
                  <ArrowRight size={12} /> {t('scrum.dropHint')}
                  {s.capacity != null && <span className="ml-auto">{t('scrum.capacity', { n: s.capacity })}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sprints view (active sprint board + burndown + velocity)            */
/* ------------------------------------------------------------------ */
/* Plain confirm for completing a sprint — warns how many unfinished issues
   move back to the product backlog. Mirrors ConfirmDeleteSprint's shape. */
function ConfirmCompleteSprint({
  open,
  onOpenChange,
  unfinished,
  busy,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  unfinished: number;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="w-[min(420px,92vw)]">
        <div className="flex items-start gap-3 px-[18px] pb-1 pt-[18px]">
          <span
            className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-full"
            style={{ background: 'var(--brand-orange-faint, var(--surface-2))', color: 'var(--brand-orange)' }}
          >
            <CheckCircle2 size={17} />
          </span>
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-[15px] font-semibold text-fg-1">
              {t('scrum.completeTitle')}
            </DialogPrimitive.Title>
            <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">
              {unfinished > 0 ? t('scrum.completeBody', { count: unfinished }) : t('scrum.completeBodyDone')}
            </p>
            {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="md" onClick={onConfirm} disabled={busy}>
            {t('scrum.completeSprint')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SprintsView({
  sprint = null,
  onSelectSprint,
  onOpen,
}: {
  // selected sprint id (driven by the ?selected= URL param); null → fall back to active
  sprint?: string | null;
  // '' clears the selection (used after deleting the selected sprint)
  onSelectSprint?: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const sd = useSprintDict();
  const { projectById, releaseById, productById, can } = useAppData();
  const canWrite = can('sprints', 'write');
  const { data: sprints = [] } = useSprints();
  const active = sprints.find((s) => s.status === 'active') ?? sprints[0];
  const sprintId = sprint ?? active?.id ?? null;
  const selected = sprints.find((s) => s.id === sprintId);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [modal, setModal] = React.useState<{ open: boolean; sprint: Sprint | null }>({
    open: false,
    sprint: null,
  });
  const [confirmComplete, setConfirmComplete] = React.useState(false);
  const [confirmDel, setConfirmDel] = React.useState(false);
  const [lifecycleErr, setLifecycleErr] = React.useState<string | null>(null);
  const start = useStartSprint();
  const complete = useCompleteSprint();
  const del = useDeleteSprint();
  const pick = (id: string) => {
    onSelectSprint?.(id);
    setPickerOpen(false);
  };

  const { data: detail } = useSprint(sprintId);
  const { data: burndown } = useBurndown(sprintId);
  const { data: velocity } = useVelocity();

  const lifecycleError = (e: unknown) => (e instanceof ApiError ? e.message : String(e));
  const doStart = (id: string) => {
    setLifecycleErr(null);
    start.mutate(id, { onError: (e) => setLifecycleErr(lifecycleError(e)) });
  };
  const doComplete = (id: string) => {
    setLifecycleErr(null);
    complete.mutate(id, {
      onSuccess: () => setConfirmComplete(false),
      onError: (e) => setLifecycleErr(lifecycleError(e)),
    });
  };
  const doDelete = (id: string) => {
    del.mutate(id, {
      onSuccess: () => {
        setConfirmDel(false);
        if (id === sprintId) onSelectSprint?.('');
      },
    });
  };

  const cols = [
    { k: 'todo', label: t('scrum.col.todo'), match: (s: string) => ['backlog', 'todo'].includes(s) },
    { k: 'in_progress', label: t('scrum.col.in_progress'), match: (s: string) => s === 'in_progress' },
    { k: 'testing', label: t('scrum.col.testing'), match: (s: string) => s === 'testing' },
    { k: 'done', label: t('scrum.col.done'), match: (s: string) => ['done', 'canceled'].includes(s) },
  ];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader title={t('scrum.sprintsTitle')} count={sprints.length}>
        {/* Sprint picker — a grouped dropdown so it scales to many sprints (an
            inline toggle row overflows once there are more than a handful). */}
        {sprints.length > 0 && (
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <button className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] text-fg-1 hover:bg-surface-2">
                <Target size={14} className="text-brand-blue" />
                <span className="max-w-[220px] truncate font-medium">{selected?.name ?? t('scrum.noSprint')}</span>
                {selected?.status === 'active' && (
                  <Badge tone="orange" dot>
                    {t('scrum.current')}
                  </Badge>
                )}
                <ChevronDown size={14} className="text-fg-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent style={{ width: 268 }} align="end">
              {(['active', 'planned', 'completed'] as const).map((st) => {
                const group = sprints.filter((s) => s.status === st);
                if (!group.length) return null;
                return (
                  <div key={st}>
                    <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
                      {t(`sprintStatus.${st}`)}
                    </div>
                    {group.map((s) => (
                      <MenuItem
                        key={s.id}
                        glyph={<Target size={14} className="flex-none text-brand-blue" />}
                        label={s.name}
                        selected={s.id === sprintId}
                        onClick={() => pick(s.id)}
                      />
                    ))}
                  </div>
                );
              })}
            </PopoverContent>
          </Popover>
        )}
        {canWrite && (
          <Button variant="secondary" size="md" onClick={() => setModal({ open: true, sprint: null })}>
            <Plus size={14} /> {sd.create}
          </Button>
        )}
      </ViewHeader>

      <div className="flex-1 overflow-y-auto p-6">
        {detail && (
          <>
            {/* summary + charts */}
            <div className="mb-5 grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1.1fr) minmax(0,1.4fr)' }}>
              {/* sprint goal + stats */}
              <div className="rounded-[14px] border border-border bg-surface p-5 shadow-1">
                <div className="mb-1 flex items-center gap-2">
                  <Target size={18} className="text-brand-blue" />
                  <span className="text-[16px] font-semibold text-fg-1">{detail.name}</span>
                  <Badge tone={SPRINT_STATUS[detail.status].tone} dot>
                    {t(`sprintStatus.${detail.status}`)}
                  </Badge>
                  <div className="ml-auto flex items-center gap-1">
                    <ResourcePanelCompact nodeType="sprint" nodeId={detail.id} variant="compact" />
                  </div>
                </div>
                {/* PMS-2 §6.6: a sprint may span several projects → version
                    lineage renders one breadcrumb per project. */}
                {(() => {
                  const projs = detail.projectIds.map((id) => projectById(id)).filter((p) => !!p);
                  return projs.length ? (
                    <div className="mb-2.5 max-w-full rounded-md bg-surface-2 px-2 py-1 text-[11.5px] text-fg-2">
                      <div className="text-fg-3">{t('hub.sprintProject')}</div>
                      {projs.map((p) => {
                        const release = releaseById(p.releaseId);
                        const product = productById(release?.productId);
                        return (
                          <div key={p.id} className="flex min-w-0 items-center gap-1">
                            <span className="truncate">{p.name}</span>
                            {release && (
                              <>
                                <ChevronRight size={11} className="flex-none text-fg-3" />
                                {product && <span className="truncate">{product.name}</span>}
                                <span className="truncate font-mono font-semibold text-fg-1">{release.name}</span>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null;
                })()}
                {detail.goal ? (
                  <Markdown text={detail.goal} className="mb-3 text-[12.5px] leading-snug text-fg-3" />
                ) : (
                  <div className="mb-3 text-[12.5px] leading-snug text-fg-3">—</div>
                )}
                <div className="mb-2 flex items-center gap-2.5">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className="h-full rounded-full bg-brand-blue"
                      style={{
                        width: `${detail.stats.committedPoints ? (detail.stats.completedPoints / detail.stats.committedPoints) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-[13px] font-semibold text-fg-1">
                    {detail.stats.completedPoints}/{detail.stats.committedPoints}
                  </span>
                </div>
                <div className="text-[12.5px] text-fg-3">
                  {t('scrum.summary', { done: detail.stats.doneCount, total: detail.stats.issueCount, pts: detail.stats.remainingPoints })}
                </div>
                {/* lifecycle actions: start (planned) / complete (active) stay
                    text buttons; edit is an always-available icon button, delete
                    an icon button offered while still planned */}
                {canWrite && (
                  <div className="mt-3.5 flex items-center gap-2">
                    {detail.status === 'planned' && (
                      <Button variant="primary" size="md" onClick={() => doStart(detail.id)} disabled={start.isPending}>
                        <Play size={14} /> {t('scrum.startSprint')}
                      </Button>
                    )}
                    {detail.status === 'active' && (
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() => {
                          setLifecycleErr(null);
                          setConfirmComplete(true);
                        }}
                      >
                        <CheckCircle2 size={14} /> {t('scrum.completeSprint')}
                      </Button>
                    )}
                    <button
                      onClick={() => setModal({ open: true, sprint: detail })}
                      title={sd.edit}
                      className="grid h-7 w-7 place-items-center rounded-lg text-fg-3 hover:bg-surface-2 hover:text-fg-1"
                    >
                      <Pencil size={13.5} />
                    </button>
                    {detail.status === 'planned' && (
                      <button
                        onClick={() => setConfirmDel(true)}
                        title={sd.del}
                        className="grid h-7 w-7 place-items-center rounded-lg text-fg-3 hover:bg-surface-2 hover:text-danger"
                      >
                        <Trash2 size={13.5} />
                      </button>
                    )}
                  </div>
                )}
                {lifecycleErr && !confirmComplete && (
                  <div className="mt-2 text-[12px] text-danger">{lifecycleErr}</div>
                )}
              </div>

              {/* burndown */}
              <div className="rounded-[14px] border border-border bg-surface p-4 shadow-1">
                <div className="mb-1 flex items-center gap-1.5 px-1 text-[12.5px] font-semibold text-fg-2">
                  <Flame size={14} className="text-brand-orange" /> {t('scrum.burndown')}
                </div>
                {burndown ? <BurndownChart data={burndown} /> : <div className="h-[200px]" />}
              </div>

              {/* velocity */}
              <div className="rounded-[14px] border border-border bg-surface p-4 shadow-1">
                <div className="mb-2 flex items-center gap-1.5 px-1 text-[12.5px] font-semibold text-fg-2">
                  <Gauge size={14} className="text-brand-blue" /> {t('scrum.velocity')}
                </div>
                {velocity ? <VelocityChart data={velocity} /> : null}
              </div>
            </div>

            {/* sprint board (read-only columns; planning happens via drag & drop
                on the backlog view) */}
            <div className="grid grid-cols-4 gap-4">
              {cols.map((col) => {
                const items = detail.issues.filter((i) => col.match(i.status));
                const pts = items.reduce((s, i) => s + (i.storyPoints ?? 0), 0);
                return (
                  <div key={col.k}>
                    <div className="mb-2.5 flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-fg-1">{col.label}</span>
                      <span className="text-[12px] text-fg-3">{items.length}</span>
                      <span className="ml-auto rounded-full bg-surface-2 px-1.5 text-[11px] font-semibold text-fg-3">
                        {pts}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {items.map((i) => (
                        <ScrumIssueRow key={i.id} issue={i} onOpen={onOpen} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {!detail && <div className="grid h-40 place-items-center text-[13px] text-fg-3">{t('scrum.noSprint')}</div>}
      </div>

      <SprintModal
        open={modal.open}
        onOpenChange={(o) => setModal((m) => ({ ...m, open: o }))}
        sprint={modal.sprint}
        onCreated={(id) => onSelectSprint?.(id)}
        onDeleted={(id) => {
          if (id === sprintId) onSelectSprint?.('');
        }}
      />
      {detail && (
        <>
          <ConfirmCompleteSprint
            open={confirmComplete}
            onOpenChange={setConfirmComplete}
            unfinished={detail.issues.filter((i) => !['done', 'canceled'].includes(i.status)).length}
            busy={complete.isPending}
            error={lifecycleErr}
            onConfirm={() => doComplete(detail.id)}
          />
          <ConfirmDeleteSprint
            open={confirmDel}
            onOpenChange={setConfirmDel}
            busy={del.isPending}
            onConfirm={() => doDelete(detail.id)}
          />
        </>
      )}
    </div>
  );
}
