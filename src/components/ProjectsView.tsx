'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Hash, Target, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ProjectIcon } from '@/components/glyphs/misc';
import { PROJECT_STATUS, PROJECT_PHASE, PROJECT_PHASE_ORDER } from '@/lib/constants';
import { useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';
import { useAllIssues } from '@/store/issues';
import { useArchiveProject, useDeleteProject } from '@/store/projects';
import { ProjectModal } from '@/components/ProjectModal';
import { ResourcePanel } from '@/components/ResourcePanel';
import { RowActions } from '@/components/RowActions';
import { ConfirmDestructive } from '@/components/ConfirmDestructive';
import type { Project, ProjectPhase } from '@/lib/types';

function ViewHeader({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-6 py-3.5">
      <h1 className="m-0 text-[18px] font-semibold tracking-tight text-fg-1">{title}</h1>
      {count != null && (
        <span className="rounded-full bg-surface-2 px-2.5 py-px text-[12.5px] font-semibold text-fg-3">
          {count}
        </span>
      )}
      <div className="flex-1" />
      {children}
    </div>
  );
}

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

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */
export function ProjectsView() {
  const t = useT();
  const router = useRouter();
  const { projects, releaseById, productById, can, companyRole, isPlatformAdmin } = useAppData();
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
  // 已归档项目卡片默认隐藏,可切换查看。
  const [showArchived, setShowArchived] = React.useState(false);
  const shownProjects = showArchived ? projects : projects.filter((p) => !p.archivedAt);
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
      <ViewHeader title={t('projects.title')} count={shownProjects.length}>
        <button
          onClick={() => setShowArchived(!showArchived)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] ${
            showArchived
              ? 'border-brand-blue bg-brand-blue/10 text-brand-blue'
              : 'border-border bg-surface text-fg-2 hover:bg-surface-2'
          }`}
        >
          <Archive size={14} /> {t('issues.showArchived')}
        </button>
        {canCreate && (
          <Button variant="primary" size="md" onClick={openNew}>
            <Plus size={14} /> {t('projects.new')}
          </Button>
        )}
      </ViewHeader>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
          {shownProjects.map((p) => {
            const ps = PROJECT_STATUS[p.status];
            const cnt = issues.filter((i) => i.projectId === p.id).length;
            const release = releaseById(p.releaseId);
            const product = productById(release?.productId);
            return (
              <div
                key={p.id}
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
                      <RowActions
                        onEdit={() => openEdit(p)}
                        onArchive={() => archive.mutate({ id: p.id, archived: !p.archivedAt })}
                        archived={!!p.archivedAt}
                        onDelete={() => setDelProject(p)}
                      />
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
                  <ResourcePanel nodeType="project" nodeId={p.id} variant="compact" />
                  <div className="flex-1" />
                  <span className="inline-flex items-center gap-1 text-[12px] text-fg-3">
                    <Hash size={13} />
                    {cnt}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[12px] text-fg-3">
                    <Target size={13} />
                    {p.target}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
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
