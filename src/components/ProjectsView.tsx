'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Hash, Target, Archive, Filter, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverTrigger, PopoverContent, MenuItem } from '@/components/ui/popover';
import { SegBtn } from '@/components/ui/segmented';
import { Avatar } from '@/components/glyphs/Avatar';
import { ProjectIcon } from '@/components/glyphs/misc';
import { PROJECT_STATUS, PROJECT_STATUS_ORDER, PROJECT_PHASE, PROJECT_PHASE_ORDER } from '@/lib/constants';
import { usePersistentState } from '@/lib/prefs';
import { useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';
import { useAllIssues } from '@/store/issues';
import { useArchiveProject, useDeleteProject } from '@/store/projects';
import { ProjectModal } from '@/components/ProjectModal';
import { ResourcePanelCompact } from '@/components/ResourcePanelCompact';
import { RowActions } from '@/components/RowActions';
import { ConfirmDestructive } from '@/components/ConfirmDestructive';
import { cn } from '@/lib/utils';
import type { Project, ProjectPhase } from '@/lib/types';

type GroupBy = 'none' | 'status' | 'lead';
type ScopeFilter = 'all' | 'mine';

/* Validators for the persisted toolbar prefs (browser memory) — same pattern as
   IssuesView: reject values written by older versions or foreign code. */
const GROUP_BYS: GroupBy[] = ['none', 'status', 'lead'];
const isGroupBy = (v: unknown): v is GroupBy => GROUP_BYS.includes(v as GroupBy);
const isScope = (v: unknown): v is ScopeFilter => v === 'all' || v === 'mine';
const isProductFilter = (v: unknown): v is string => typeof v === 'string';
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

function ProgressRing({ value, size = 26, color = 'var(--brand-blue)' }: { value: number; size?: number; color?: string }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-none">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth="3" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${c * value} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/* Product Life Cycle phase stepper — shows the project's position in the
   concept → development → release → maintenance → retired lifecycle. */
function PhaseStepper({ phase }: { phase: ProjectPhase }) {
  const t = useT();
  const idx = PROJECT_PHASE_ORDER.indexOf(phase);
  const cur = PROJECT_PHASE[phase];
  return (
    <div className="mb-3.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-fg-3">
        <span className="uppercase tracking-wider">{t('plc.title')}</span>
        <span className="ml-auto font-semibold" style={{ color: cur.color }}>
          {t(`phase.${phase}`)}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {PROJECT_PHASE_ORDER.map((ph, i) => {
          const done = i <= idx;
          return (
            <div
              key={ph}
              title={t(`phase.${ph}`)}
              className="h-1.5 flex-1 rounded-full transition-colors"
              style={{ background: done ? cur.color : 'var(--surface-sunken)' }}
            />
          );
        })}
      </div>
    </div>
  );
}

function ProjectCard({
  p,
  cnt,
  canManage,
  onEdit,
  onArchive,
  onDelete,
}: {
  p: Project;
  cnt: number;
  canManage: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const { releaseById, productById } = useAppData();
  const ps = PROJECT_STATUS[p.status];
  const release = releaseById(p.releaseId);
  const product = productById(release?.productId);
  return (
    <div
      onClick={() => router.push(`/projects/${p.id}`)}
      className="lift-card group cursor-pointer rounded-[14px] border border-border bg-surface p-[18px] shadow-1"
    >
      <div className="mb-3.5 flex items-center gap-2.5">
        <span
          className="grid h-9 w-9 flex-none place-items-center rounded-[10px]"
          style={{ background: p.color }}
        >
          <ProjectIcon name={p.icon} size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-fg-1">{p.name}</div>
          <div className="flex items-center gap-1.5">
            <Badge tone={ps.tone} dot>
              {t(`projectStatus.${p.status}`)}
            </Badge>
            {p.archivedAt && (
              <Badge tone="neutral">
                <Archive size={11} /> {t('issue.archived')}
              </Badge>
            )}
          </div>
        </div>
        <div className="opacity-0 transition-opacity group-hover:opacity-100">
          {canManage && (
            <RowActions onEdit={onEdit} onArchive={onArchive} archived={!!p.archivedAt} onDelete={onDelete} />
          )}
        </div>
        <ProgressRing value={p.progress} color={p.color} />
      </div>
      <p className="mb-3 min-h-[40px] text-[13px] leading-normal text-fg-2">
        {p.description}
      </p>
      {release && (
        <div className="mb-3 inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-[11.5px] text-fg-2">
          <Target size={12} className="flex-none text-fg-3" />
          {product && <span className="truncate">{product.name}</span>}
          <span className="font-mono font-semibold text-fg-1">{release.name}</span>
        </div>
      )}
      {/* PMS-2: lifecycle phase comes from the project's release */}
      {release && <PhaseStepper phase={release.phase} />}
      {/* 研发团队(虚拟团队)直接上卡片,交互同迭代卡片:avatar 堆叠
          + Popover 指派;指派的 role=lead 即新 lead 展示(legacy
          leadId/aiLeadId 字段保留于编辑弹窗,卡片不再展示)。 */}
      <div className="flex items-center gap-2.5 border-t border-border pt-3">
        <ResourcePanelCompact nodeType="project" nodeId={p.id} variant="compact" />
        <div className="flex-1" />
        <span className="inline-flex items-center gap-1 text-[12px] text-fg-3">
          <Hash size={13} />
          {cnt}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */
export function ProjectsView() {
  const t = useT();
  const { projects, myProjectIds, products, releaseById, productById, memberById, humans, agents, can, companyRole, isPlatformAdmin } = useAppData();
  const { data: issues = [] } = useAllIssues();
  const del = useDeleteProject();
  const archive = useArchiveProject();
  // RBAC gate (P5): creating needs projects:write; editing/deleting a project
  // additionally requires company admin (or platform admin) — the old
  // role==='admin' gate's semantics carried over.
  const canCreate = can('projects', 'write');
  const canManage =
    canCreate && (companyRole === 'company_admin' || isPlatformAdmin);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editProject, setEditProject] = React.useState<Project | null>(null);
  const [delProject, setDelProject] = React.useState<Project | null>(null);

  /* Toolbar prefs — 浏览器记忆(localStorage,usePersistentState),交互与持久化
     口径同全部 Issues 列表。「全部/我参与的」默认我参与的:管理员的项目列表是
     全量,普通成员的 bootstrap 列表本身已按参与过滤,两种范围结果一致。 */
  const [scope, setScope] = usePersistentState<ScopeFilter>('projects.scope', 'mine', isScope);
  const [productFilter, setProductFilter] = usePersistentState<string>('projects.productFilter', 'all', isProductFilter);
  const [groupBy, setGroupBy] = usePersistentState<GroupBy>('projects.groupBy', 'none', isGroupBy);
  // 已归档项目卡片默认隐藏,可切换查看。
  const [showArchived, setShowArchived] = usePersistentState<boolean>('projects.showArchived', false, isBoolean);
  const [fltOpen, setFltOpen] = React.useState(false);
  const [grpOpen, setGrpOpen] = React.useState(false);

  const mineSet = React.useMemo(() => new Set(myProjectIds), [myProjectIds]);
  // 顶层筛选(范围、产品)先应用,分组在结果集上进行。产品筛选与侧边栏
  // 「项目」菜单的快捷筛选同一浏览器记忆 key(projects.productFilter)。
  const shownProjects = projects.filter(
    (p) =>
      (showArchived || !p.archivedAt) &&
      (scope === 'all' || mineSet.has(p.id)) &&
      (productFilter === 'all' || releaseById(p.releaseId)?.productId === productFilter),
  );

  // 分组:不分组时单组直出网格;状态/负责人分组跳过空组。
  const groups = React.useMemo(() => {
    if (groupBy === 'status')
      return PROJECT_STATUS_ORDER.map((k) => ({
        key: k as string,
        label: t(`projectStatus.${k}`),
        items: shownProjects.filter((p) => p.status === k),
      })).filter((g) => g.items.length > 0);
    if (groupBy === 'lead')
      return [...humans.map((m) => m.id), ...agents.map((m) => m.id), '_none']
        .map((k) => ({
          key: k,
          label: k === '_none' ? t('common.unassigned') : memberById(k)?.name ?? k,
          items: shownProjects.filter((p) => (p.leadId ?? '_none') === k),
        }))
        .filter((g) => g.items.length > 0);
    return shownProjects.length ? [{ key: '_all', label: '', items: shownProjects }] : [];
  }, [groupBy, shownProjects, humans, agents, memberById, t]);

  const openNew = () => {
    setEditProject(null);
    setModalOpen(true);
  };
  const openEdit = (p: Project) => {
    setEditProject(p);
    setModalOpen(true);
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="border-b border-border">
        <div className="flex items-center gap-3 px-6 pb-3 pt-3.5">
          <h1 className="m-0 text-[18px] font-semibold tracking-tight text-fg-1">{t('projects.title')}</h1>
          <span className="rounded-full bg-surface-2 px-2.5 py-px text-[12.5px] font-semibold text-fg-3">
            {shownProjects.length}
          </span>
          <div className="flex-1" />
          {canCreate && (
            <Button variant="primary" size="md" onClick={openNew}>
              <Plus size={14} /> {t('projects.new')}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 px-6 pb-3">
          {/* 筛选(按产品):项目经 release 归属产品。 */}
          <Popover open={fltOpen} onOpenChange={setFltOpen}>
            <PopoverTrigger asChild>
              <button className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[13px] text-fg-2 hover:bg-surface-2">
                <Filter size={14} /> {t('issues.filter')}
                {productFilter !== 'all' && (productById(productFilter)?.name ?? productFilter)}
              </button>
            </PopoverTrigger>
            <PopoverContent style={{ width: 200 }} align="start">
              <MenuItem
                label={t('common.all')}
                selected={productFilter === 'all'}
                onClick={() => {
                  setProductFilter('all');
                  setFltOpen(false);
                }}
              />
              {products.map((p) => (
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
                  selected={productFilter === p.id}
                  onClick={() => {
                    setProductFilter(p.id);
                    setFltOpen(false);
                  }}
                />
              ))}
            </PopoverContent>
          </Popover>
          {/* 分组:不分组 / 状态 / 负责人。 */}
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
                  ['none', t('group.none')],
                  ['status', t('group.status')],
                  ['lead', t('group.lead')],
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
          {/* 范围:全部 / 我参与的(默认我参与的)。 */}
          <div className="inline-flex gap-0.5 rounded-lg bg-surface-2 p-0.5">
            <SegBtn active={scope === 'all'} onClick={() => setScope('all')}>
              {t('common.all')}
            </SegBtn>
            <SegBtn active={scope === 'mine'} onClick={() => setScope('mine')}>
              {t('projects.mine')}
            </SegBtn>
          </div>
          {/* 显示已归档开关(默认隐藏已归档项目)。 */}
          <button
            onClick={() => setShowArchived(!showArchived)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[13px]',
              showArchived
                ? 'border-brand-blue bg-brand-blue/10 text-brand-blue'
                : 'border-border bg-surface text-fg-2 hover:bg-surface-2',
            )}
          >
            <Archive size={14} /> {t('issues.showArchived')}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {groups.map((g) => (
          <div key={g.key} className="mb-6 last:mb-0">
            {groupBy !== 'none' && (
              <div className="mb-3 flex items-center gap-2.5 px-0.5 py-1">
                {groupBy === 'lead' && (
                  <Avatar person={g.key === '_none' ? null : memberById(g.key)} size={18} />
                )}
                <span className="text-[13px] font-semibold text-fg-1">{g.label}</span>
                <span className="text-[12px] text-fg-3">{g.items.length}</span>
              </div>
            )}
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
              {g.items.map((p) => (
                <ProjectCard
                  key={p.id}
                  p={p}
                  cnt={issues.filter((i) => i.projectId === p.id).length}
                  canManage={canManage}
                  onEdit={() => openEdit(p)}
                  onArchive={() => archive.mutate({ id: p.id, archived: !p.archivedAt })}
                  onDelete={() => setDelProject(p)}
                />
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <div className="grid h-full place-items-center text-[13px] text-fg-3">{t('projects.empty')}</div>
        )}
      </div>
      <ProjectModal open={modalOpen} onOpenChange={setModalOpen} project={editProject} />
      {delProject && (
        <ConfirmDestructive
          open
          onOpenChange={(o) => !o && setDelProject(null)}
          name={delProject.name}
          node={{ nodeType: 'project', nodeId: delProject.id }}
          busy={del.isPending}
          onConfirm={() => del.mutate(delProject.id, { onSuccess: () => setDelProject(null) })}
        />
      )}
    </div>
  );
}
