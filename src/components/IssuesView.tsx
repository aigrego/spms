'use client';

import * as React from 'react';
import { Plus, Filter, SlidersHorizontal, List, Columns3, GitBranch, MessageSquare, ChevronDown, ChevronRight, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent, MenuItem } from '@/components/ui/popover';
import { StatusIcon } from '@/components/glyphs/StatusIcon';
import { PriorityIcon } from '@/components/glyphs/PriorityIcon';
import { ImportanceIcon } from '@/components/glyphs/ImportanceIcon';
import { TypeIcon } from '@/components/glyphs/TypeIcon';
import { Avatar } from '@/components/glyphs/Avatar';
import { AISlaBadge, ProjectIcon } from '@/components/glyphs/misc';
import { TypeMenu, StatusMenu, PriorityMenu, ImportanceMenu, AssigneeMenu } from '@/components/menus';
import { InlineCreateRow, EditableTitle } from '@/components/inline';
import { SegBtn } from '@/components/ui/segmented';
import { STATUS_ORDER, PRIORITY_ORDER, IMPORTANCE_ORDER } from '@/lib/constants';
import { usePersistentState } from '@/lib/prefs';
import { relativeTime } from '@/lib/time';
import { useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';
import { useCreateIssue } from '@/store/issues';
import { cn } from '@/lib/utils';
import type { Issue, IssueStatus, IssuePriority, Importance, IssueType, Label } from '@/lib/types';
import type { CreateIssueInput, UpdateIssueInput } from '@/lib/api';

type GroupBy = 'status' | 'priority' | 'importance' | 'assignee' | 'project';
// Top-level type filter (segmented), in the order the user reads it: 全部 缺陷 工单 备忘.
type TypeFilter = IssueType | 'all';
const TYPE_FILTERS: TypeFilter[] = ['all', 'bug', 'ticket', 'backlog'];
type ViewMode = 'list' | 'board';

/* Validators for the persisted toolbar prefs (browser memory) — reject values
   written by older versions or foreign code so the view never breaks. */
const GROUP_BYS: GroupBy[] = ['status', 'priority', 'importance', 'assignee', 'project'];
const isGroupBy = (v: unknown): v is GroupBy => GROUP_BYS.includes(v as GroupBy);
const isTypeFilter = (v: unknown): v is TypeFilter => TYPE_FILTERS.includes(v as TypeFilter);
const isViewMode = (v: unknown): v is ViewMode => v === 'list' || v === 'board';
const isProjectFilter = (v: unknown): v is string => typeof v === 'string';

interface RowProps {
  issue: Issue;
  onOpen: (id: string) => void;
  onUpdate: (id: string, patch: UpdateIssueInput) => void;
  labelsFor: (ids: string[]) => Label[];
}

const iconBtn =
  'inline-grid place-items-center flex-none cursor-pointer rounded-[5px] p-0.5 hover:bg-surface-2';

function IssueRow({ issue, onOpen, onUpdate, labelsFor }: RowProps) {
  const t = useT();
  const { memberById } = useAppData();
  const assignee = memberById(issue.assigneeId);
  const labels = labelsFor(issue.labels);

  return (
    <div
      onClick={() => onOpen(issue.id)}
      className={cn(
        'issue-row flex h-[42px] cursor-pointer items-center gap-2.5 border-b border-border px-5 transition-colors hover:bg-surface-2',
        issue.archivedAt && 'opacity-50',
      )}
    >
      <PriorityMenu
        current={issue.priority}
        onPick={(p) => onUpdate(issue.id, { priority: p })}
        trigger={
          <button className={iconBtn}>
            <PriorityIcon priority={issue.priority} size={16} />
          </button>
        }
      />
      <ImportanceMenu
        current={issue.importance}
        onPick={(p) => onUpdate(issue.id, { importance: p })}
        trigger={
          <button className={iconBtn} title={t('detail.importance')}>
            <ImportanceIcon importance={issue.importance} size={15} />
          </button>
        }
      />
      <TypeMenu
        current={issue.type}
        onPick={(ty) => onUpdate(issue.id, { type: ty })}
        trigger={
          <button className={iconBtn} title={t('menu.type')}>
            <TypeIcon type={issue.type} size={15} />
          </button>
        }
      />
      <span className="w-[62px] flex-none font-mono text-xs text-fg-3">{issue.id}</span>
      <StatusMenu
        current={issue.status}
        onPick={(s) => onUpdate(issue.id, { status: s })}
        trigger={
          <button className={iconBtn}>
            <StatusIcon status={issue.status} size={16} />
          </button>
        }
      />
      <EditableTitle
        value={issue.title}
        onSave={(title) => onUpdate(issue.id, { title })}
        className="min-w-0 flex-1 text-[13.5px] font-normal text-fg-1"
      />
      <div className="flex flex-none items-center gap-1.5">
        {issue.aiAssigned && <AISlaBadge />}
        {labels.map((l) => (
          <span
            key={l.id}
            className="inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-fg-2"
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: l.color }} />
            {l.name}
          </span>
        ))}
        {issue.sub && (
          <span className="inline-flex items-center gap-1 font-mono text-[11.5px] text-fg-3">
            <GitBranch size={12} />
            {issue.sub.done}/{issue.sub.total}
          </span>
        )}
        {issue.commentsCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[11.5px] text-fg-3">
            <MessageSquare size={12} />
            {issue.commentsCount}
          </span>
        )}
        <span className="w-16 text-right text-[11.5px] text-fg-3">
          {relativeTime(issue.updatedAt, t)}
        </span>
        <AssigneeMenu
          current={issue.assigneeId}
          onPick={(a) => onUpdate(issue.id, { assigneeId: a })}
          trigger={
            <button className={iconBtn}>
              <Avatar person={assignee} size={22} />
            </button>
          }
        />
      </div>
    </div>
  );
}

function IssueCard({
  issue,
  onOpen,
  onUpdate,
  labelsFor,
  onDragStart,
}: RowProps & { onDragStart: (e: React.DragEvent, id: string) => void }) {
  const t = useT();
  const { memberById } = useAppData();
  const assignee = memberById(issue.assigneeId);
  const labels = labelsFor(issue.labels);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, issue.id)}
      onClick={() => onOpen(issue.id)}
      className="mb-2 cursor-pointer rounded-[10px] border border-border bg-surface p-3 shadow-1 transition-shadow hover:shadow-2"
    >
      <div className="mb-[7px] flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <TypeIcon type={issue.type} size={14} />
          <span className="flex-none whitespace-nowrap font-mono text-[11.5px] text-fg-3">
            {issue.id}
          </span>
        </span>
        <div className="flex items-center gap-0.5">
          <ImportanceMenu
            current={issue.importance}
            onPick={(p) => onUpdate(issue.id, { importance: p })}
            trigger={
              <button className={iconBtn} title={t('detail.importance')}>
                <ImportanceIcon importance={issue.importance} size={15} />
              </button>
            }
          />
          <PriorityMenu
            current={issue.priority}
            onPick={(p) => onUpdate(issue.id, { priority: p })}
            trigger={
              <button className={iconBtn}>
                <PriorityIcon priority={issue.priority} size={15} />
              </button>
            }
          />
        </div>
      </div>
      <div className="mb-2.5 text-[13.5px] font-normal leading-snug text-fg-1">{issue.title}</div>
      {(labels.length > 0 || issue.aiAssigned) && (
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          {issue.aiAssigned && <AISlaBadge />}
          {labels.map((l) => (
            <span
              key={l.id}
              className="inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-full bg-surface-2 px-[7px] py-0.5 text-[10.5px] font-medium text-fg-2"
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: l.color }} />
              {l.name}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {issue.sub && (
            <span className="inline-flex items-center gap-0.5 font-mono text-[11px] text-fg-3">
              <GitBranch size={12} />
              {issue.sub.done}/{issue.sub.total}
            </span>
          )}
          {issue.commentsCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-fg-3">
              <MessageSquare size={12} />
              {issue.commentsCount}
            </span>
          )}
          {issue.estimate != null && (
            <span className="rounded-[5px] bg-surface-2 px-1.5 py-px text-[10.5px] font-semibold text-fg-3">
              {issue.estimate}
            </span>
          )}
        </div>
        <AssigneeMenu
          current={issue.assigneeId}
          onPick={(a) => onUpdate(issue.id, { assigneeId: a })}
          trigger={
            <button className={iconBtn}>
              <Avatar person={assignee} size={22} />
            </button>
          }
        />
      </div>
    </div>
  );
}

function GroupHeaderGlyph({ groupBy, k }: { groupBy: GroupBy; k: string }) {
  const { memberById, projectById } = useAppData();
  if (groupBy === 'status') return <StatusIcon status={k as IssueStatus} size={15} />;
  if (groupBy === 'priority') return <PriorityIcon priority={k as IssuePriority} size={15} />;
  if (groupBy === 'importance') return <ImportanceIcon importance={k as Importance} size={15} />;
  if (groupBy === 'project') {
    const p = k === '_none' ? null : projectById(k);
    return (
      <span
        className="grid h-4 w-4 flex-none place-items-center rounded bg-surface-2"
        style={p ? { background: p.color } : undefined}
      >
        {p && <ProjectIcon name={p.icon} size={11} />}
      </span>
    );
  }
  return <Avatar person={k === '_none' ? null : memberById(k)} size={18} />;
}

export function IssuesView({
  issues,
  title,
  subtitle,
  showArchived,
  onToggleArchived,
  onOpen,
  onUpdate,
  onNewIssue,
  onVisibleKeysChange,
}: {
  issues: Issue[];
  title: string;
  subtitle?: string;
  showArchived?: boolean;
  onToggleArchived?: (v: boolean) => void;
  onOpen: (id: string) => void;
  onUpdate: (id: string, patch: UpdateIssueInput) => void;
  onNewIssue: (preset?: { status?: IssueStatus }) => void;
  /* 当前可见列表(过滤+分组后的展示顺序)变化时上报有序 key 集,
     供详情抽屉的上一个/下一个翻页限定在当前列表(TKT-26)。 */
  onVisibleKeysChange?: (keys: string[]) => void;
}) {
  const t = useT();
  const { humans, agents, projects, projectById, labelById, memberById, can } = useAppData();
  const canWrite = can('issues', 'write');
  const create = useCreateIssue();
  const [viewMode, setViewMode] = usePersistentState<ViewMode>('issues.viewMode', 'list', isViewMode);
  const [groupBy, setGroupBy] = usePersistentState<GroupBy>('issues.groupBy', 'status', isGroupBy);
  const [typeFilter, setTypeFilter] = usePersistentState<TypeFilter>('issues.typeFilter', 'all', isTypeFilter);
  const [projectFilter, setProjectFilter] = usePersistentState<string>('issues.projectFilter', 'all', isProjectFilter);
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const [dragOver, setDragOver] = React.useState<string | null>(null);
  const [grpOpen, setGrpOpen] = React.useState(false);
  const [fltOpen, setFltOpen] = React.useState(false);

  const labelsFor = React.useCallback(
    (ids: string[]) => ids.map((id) => labelById(id)).filter(Boolean) as Label[],
    [labelById],
  );

  const cfg = React.useMemo(() => {
    if (groupBy === 'status')
      return {
        keys: STATUS_ORDER as string[],
        get: (i: Issue) => i.status as string,
        label: (k: string) => t(`status.${k}`),
      };
    if (groupBy === 'priority')
      return {
        keys: PRIORITY_ORDER as string[],
        get: (i: Issue) => i.priority as string,
        label: (k: string) => t(`priority.${k}`),
      };
    if (groupBy === 'importance')
      return {
        keys: IMPORTANCE_ORDER as string[],
        get: (i: Issue) => i.importance as string,
        label: (k: string) => t(`importance.${k}`),
      };
    if (groupBy === 'project')
      return {
        keys: [...projects.map((p) => p.id), '_none'],
        get: (i: Issue) => i.projectId ?? '_none',
        label: (k: string) => (k === '_none' ? t('common.noProject') : projectById(k)?.name ?? k),
      };
    return {
      keys: [...humans.map((m) => m.id), ...agents.map((m) => m.id), '_none'],
      get: (i: Issue) => i.assigneeId ?? '_none',
      label: (k: string) => (k === '_none' ? t('common.unassigned') : memberById(k)?.name ?? k),
    };
  }, [groupBy, humans, agents, projects, projectById, memberById, t]);

  // Top-level filters (type, project) are applied first; grouping/board operate on the result.
  const shownIssues = issues.filter(
    (i) =>
      (typeFilter === 'all' || i.type === typeFilter) &&
      (projectFilter === 'all' || i.projectId === projectFilter),
  );

  const groups = cfg.keys
    .map((k) => ({ key: k, items: shownIssues.filter((i) => cfg.get(i) === k) }))
    .filter((g) => g.items.length > 0);

  /* 展示顺序(分组顺序 × 组内顺序)的有序 key 集;board 模式同样是
     按 cfg.keys 逐组铺开,顺序一致。key 不含逗号,用 join 做稳定依赖。 */
  const visibleKeysJoin = groups.flatMap((g) => g.items.map((i) => i.id)).join(',');
  React.useEffect(() => {
    onVisibleKeysChange?.(visibleKeysJoin ? visibleKeysJoin.split(',') : []);
  }, [visibleKeysJoin, onVisibleKeysChange]);

  // Inline create within a group: the new issue inherits the group's attribute, plus
  // the active type filter (so a quick-add under a type filter lands as that type).
  const presetForGroup = (key: string): Partial<CreateIssueInput> => ({
    ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
    ...(projectFilter !== 'all' ? { projectId: projectFilter } : {}),
    ...(groupBy === 'status'
      ? { status: key as IssueStatus }
      : groupBy === 'priority'
        ? { priority: key as IssuePriority }
        : groupBy === 'importance'
          ? { importance: key as Importance }
          : groupBy === 'project'
            ? { projectId: key === '_none' ? null : key }
            : { assigneeId: key === '_none' ? null : key }),
  });
  const quickCreate = (key: string, title: string) => {
    create.mutate({ title, ...presetForGroup(key) });
  };

  const onDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/id', id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDrop = (e: React.DragEvent, key: string) => {
    e.preventDefault();
    const dragId = e.dataTransfer.getData('text/id');
    if (dragId) {
      const patch: UpdateIssueInput =
        groupBy === 'status'
          ? { status: key as IssueStatus }
          : groupBy === 'priority'
            ? { priority: key as IssuePriority }
            : groupBy === 'importance'
              ? { importance: key as Importance }
              : groupBy === 'project'
                ? { projectId: key === '_none' ? null : key }
                : { assigneeId: key === '_none' ? null : key };
      onUpdate(dragId, patch);
    }
    setDragOver(null);
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="border-b border-border">
        <div className="flex items-center gap-3 px-5 pb-3 pt-3.5">
          <div className="flex-1">
            <div className="flex items-center gap-2.5">
              <h1 className="m-0 text-[18px] font-semibold tracking-tight text-fg-1">{title}</h1>
              <span className="rounded-full bg-surface-2 px-2.5 py-px text-[12.5px] font-semibold text-fg-3">
                {shownIssues.length}
              </span>
            </div>
            {subtitle && <div className="mt-0.5 text-[12.5px] text-fg-3">{subtitle}</div>}
          </div>
          {canWrite && (
            <Button variant="primary" size="md" onClick={() => onNewIssue()}>
              <Plus size={14} /> {t('issues.new')}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 px-5 pb-3">
          <Popover open={fltOpen} onOpenChange={setFltOpen}>
            <PopoverTrigger asChild>
              <button className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[13px] text-fg-2 hover:bg-surface-2">
                <Filter size={14} /> {t('issues.filter')}
                {projectFilter !== 'all' && (projectById(projectFilter)?.name ?? projectFilter)}
              </button>
            </PopoverTrigger>
            <PopoverContent style={{ width: 200 }} align="start">
              <MenuItem
                label={t('common.all')}
                selected={projectFilter === 'all'}
                onClick={() => {
                  setProjectFilter('all');
                  setFltOpen(false);
                }}
              />
              {projects.map((p) => (
                <MenuItem
                  key={p.id}
                  glyph={
                    <span
                      className="grid h-4 w-4 flex-none place-items-center rounded"
                      style={{ background: p.color }}
                    >
                      <ProjectIcon name={p.icon} size={11} />
                    </span>
                  }
                  label={p.name}
                  selected={projectFilter === p.id}
                  onClick={() => {
                    setProjectFilter(p.id);
                    setFltOpen(false);
                  }}
                />
              ))}
            </PopoverContent>
          </Popover>
          <Popover open={grpOpen} onOpenChange={setGrpOpen}>
            <PopoverTrigger asChild>
              <button className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[13px] text-fg-2 hover:bg-surface-2">
                <SlidersHorizontal size={14} /> {t('issues.groupBy')}
                {t(`group.${groupBy}`)}
              </button>
            </PopoverTrigger>
            <PopoverContent style={{ width: 160 }} align="start">
              {(
                [
                  ['status', t('group.status')],
                  ['priority', t('group.priority')],
                  ['importance', t('group.importance')],
                  ['assignee', t('group.assignee')],
                  ['project', t('group.project')],
                ] as [GroupBy, string][]
              ).map(([k, l]) => (
                <MenuItem
                  key={k}
                  label={l}
                  selected={groupBy === k}
                  onClick={() => {
                    setGroupBy(k);
                    setGrpOpen(false);
                  }}
                />
              ))}
            </PopoverContent>
          </Popover>
          {/* Type filter — a top-level toggle group alongside 分组 (全部 / 缺陷 / 工单 / 备忘). */}
          <div className="inline-flex items-center gap-1.5">
            <span className="text-[12px] text-fg-3">{t('menu.type')}</span>
            <div className="inline-flex gap-0.5 rounded-lg bg-surface-2 p-0.5">
              {TYPE_FILTERS.map((tf) => (
                <SegBtn key={tf} active={typeFilter === tf} onClick={() => setTypeFilter(tf)}>
                  {tf !== 'all' && <TypeIcon type={tf} size={13} />}
                  {tf === 'all' ? t('common.all') : t(`type.${tf}`)}
                </SegBtn>
              ))}
            </div>
          </div>
          {/* 显示已归档开关(默认隐藏已归档 issue 及已归档项目的 issue)。 */}
          {onToggleArchived && (
            <button
              onClick={() => onToggleArchived(!showArchived)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[13px]',
                showArchived
                  ? 'border-brand-blue bg-brand-blue/10 text-brand-blue'
                  : 'border-border bg-surface text-fg-2 hover:bg-surface-2',
              )}
            >
              <Archive size={14} /> {t('issues.showArchived')}
            </button>
          )}
          <div className="flex-1" />
          <div className="inline-flex gap-0.5 rounded-lg bg-surface-2 p-0.5">
            {(
              [
                ['list', List],
                ['board', Columns3],
              ] as [ViewMode, typeof List][]
            ).map(([m, Ic]) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={cn(
                  'grid h-6 w-[30px] place-items-center rounded-md',
                  viewMode === m ? 'bg-surface shadow-1 text-fg-1' : 'text-fg-3',
                )}
              >
                <Ic size={15} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      {viewMode === 'list' ? (
        <div className="flex-1 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.key}>
              <div
                onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                className="sticky top-0 z-[1] flex cursor-pointer items-center gap-2.5 border-b border-border bg-surface-2 px-5 py-1.5"
              >
                {collapsed[g.key] ? (
                  <ChevronRight size={13} className="text-fg-3" />
                ) : (
                  <ChevronDown size={13} className="text-fg-3" />
                )}
                <GroupHeaderGlyph groupBy={groupBy} k={g.key} />
                <span className="text-[13px] font-semibold text-fg-1">{cfg.label(g.key)}</span>
                <span className="text-[12px] text-fg-3">{g.items.length}</span>
                <div className="flex-1" />
                <a
                  onClick={(e) => {
                    e.stopPropagation();
                    onNewIssue(groupBy === 'status' ? { status: g.key as IssueStatus } : undefined);
                  }}
                  className="hover-surface cursor-pointer rounded-[5px] p-0.5"
                >
                  <Plus size={14} className="text-fg-3" />
                </a>
              </div>
              {!collapsed[g.key] && (
                <>
                  {g.items.map((issue) => (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      onOpen={onOpen}
                      onUpdate={onUpdate}
                      labelsFor={labelsFor}
                    />
                  ))}
                  {canWrite && (
                    <InlineCreateRow
                      label={t('inline.quickAdd')}
                      onCreate={(title) => quickCreate(g.key, title)}
                      className="border-b border-border"
                    />
                  )}
                </>
              )}
            </div>
          ))}
          {groups.length === 0 && (
            <div className="grid h-full place-items-center text-[13px] text-fg-3">{t('issues.empty')}</div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
          <div className="flex h-full items-start gap-3.5">
            {cfg.keys.map((key) => {
              const items = shownIssues.filter((i) => cfg.get(i) === key);
              return (
                <div
                  key={key}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(key);
                  }}
                  onDragLeave={() => setDragOver((d) => (d === key ? null : d))}
                  onDrop={(e) => onDrop(e, key)}
                  className="flex max-h-full w-[296px] flex-none flex-col rounded-xl p-1 transition-colors"
                  style={
                    dragOver === key
                      ? { background: 'var(--brand-blue-tint-8)', outline: '2px dashed var(--brand-blue)' }
                      : undefined
                  }
                >
                  <div className="flex items-center gap-2 px-2 pb-2.5 pt-1.5">
                    <GroupHeaderGlyph groupBy={groupBy} k={key} />
                    <span className="text-[13px] font-semibold text-fg-1">{cfg.label(key)}</span>
                    <span className="text-[12px] text-fg-3">{items.length}</span>
                    <div className="flex-1" />
                    <a
                      onClick={() =>
                        onNewIssue(groupBy === 'status' ? { status: key as IssueStatus } : undefined)
                      }
                      className="hover-surface cursor-pointer rounded-[5px] p-0.5"
                    >
                      <Plus size={14} className="text-fg-3" />
                    </a>
                  </div>
                  <div className="flex-1 overflow-y-auto px-1">
                    {items.map((issue) => (
                      <IssueCard
                        key={issue.id}
                        issue={issue}
                        onOpen={onOpen}
                        onUpdate={onUpdate}
                        labelsFor={labelsFor}
                        onDragStart={onDragStart}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
