'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronRight, Hash, Target, ChevronsRight, Link2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/glyphs/Avatar';
import { ProjectIcon } from '@/components/glyphs/misc';
import { StatusIcon } from '@/components/glyphs/StatusIcon';
import { PriorityIcon } from '@/components/glyphs/PriorityIcon';
import { ResourcePanel } from '@/components/ResourcePanel';
import { ResourcePanelCompact } from '@/components/ResourcePanelCompact';
import { TabBtn } from '@/components/ui/segmented';
import { InlineCreateRow, EditableTitle } from '@/components/inline';
import { PROJECT_STATUS, PROJECT_PHASE, REQUIREMENT_TYPE, REQUIREMENT_STATUS, TEST_RESULT, SPRINT_STATUS } from '@/lib/constants';
import { useT } from '@/lib/i18n';
import { useAppData } from '@/store/AppData';
import { useAllIssues, useCreateIssue, useUpdateIssue } from '@/store/issues';
import { useRequirements, useCreateRequirement, useUpdateRequirement } from '@/store/requirements';
import { useTestCases, useCreateTestCase, useUpdateTestCase } from '@/store/testcases';
import { usePlans } from '@/store/plans';
import { PlansPanel } from '@/components/PlansPanel';
import { useUpdateProject } from '@/store/projects';

type Tab = 'basics' | 'resources' | 'requirements' | 'plans' | 'testcases' | 'sprints' | 'issues';

/* A single PRD-basics field on the 基本信息 tab: a borderless textarea that grows
   with its content and saves on blur (only when changed). Mirrors the requirement
   PRD editor so the two read/edit the same way. */
function PrdField({ label, value, placeholder, onSave }: { label: string; value: string; placeholder: string; onSave: (v: string) => void }) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => { setV(value); }, [value]);
  return (
    <div>
      <div className="mb-1.5 text-[12.5px] font-semibold text-fg-2">{label}</div>
      <textarea
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (v.trim() !== value.trim()) onSave(v.trim()); }}
        rows={Math.max(2, v.split('\n').length)}
        placeholder={placeholder}
        className="w-full resize-none rounded-[9px] border border-transparent bg-transparent px-0 text-sm leading-relaxed text-fg-1 outline-none placeholder:text-fg-3 hover:border-border focus:border-brand-blue focus:px-2.5 focus:py-2"
      />
    </div>
  );
}

function Ring({ value, size = 52 }: { value: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-none">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth="5" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--brand-blue)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${c * value} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="fill-fg-1 text-[13px] font-semibold tabular-nums">{Math.round(value * 100)}%</text>
    </svg>
  );
}

const emptyCls = 'rounded-[10px] border border-dashed border-border px-3 py-5 text-center text-[12.5px] text-fg-3';

/* Project hub — the blueprint's in-app View switch becomes real routes:
   需求/测试用例 tabs link out to the full pools (?project=), sprint rows to
   /sprints/<id>, issue rows to /issues/<KEY>. */
export function ProjectHub({ projectId }: { projectId: string }) {
  const t = useT();
  const router = useRouter();
  const { projectById, releaseById, productById, productLineById, memberById, sprints, can } = useAppData();
  const canWriteIssues = can('issues', 'write');
  const canWriteRequirements = can('requirements', 'write');
  const canWriteTestcases = can('testcases', 'write');
  const { data: allIssues = [] } = useAllIssues(true); // 项目中心 = 历史上下文,含已归档
  const { data: requirements = [] } = useRequirements({ project: projectId });
  const { data: testCases = [] } = useTestCases({ project: projectId });
  const { data: plans = [] } = usePlans({ project: projectId });
  const createReq = useCreateRequirement();
  const updateReq = useUpdateRequirement();
  const createTc = useCreateTestCase();
  const updateTc = useUpdateTestCase();
  const createIssue = useCreateIssue();
  const updateIssue = useUpdateIssue();
  const updateProject = useUpdateProject();
  const [tab, setTab] = React.useState<Tab>('basics');

  const project = projectById(projectId);
  if (!project) return null;

  const release = releaseById(project.releaseId);
  const product = productById(release?.productId);
  const line = productLineById(product?.productLineId);
  const lead = memberById(project.leadId);
  const aiLead = memberById(project.aiLeadId);
  const ps = PROJECT_STATUS[project.status];

  const issues = allIssues.filter((i) => i.projectId === projectId);
  const done = issues.filter((i) => i.status === 'done').length;
  const points = issues.reduce((s, i) => s + (i.storyPoints ?? 0), 0);
  const projectSprints = sprints.filter((s) => s.projectIds.includes(projectId));

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'basics', label: t('hub.basics'), count: 0 },
    { key: 'resources', label: t('hub.resources'), count: 0 },
    { key: 'requirements', label: t('hub.requirements'), count: requirements.length },
    { key: 'plans', label: t('hub.plans'), count: plans.length },
    { key: 'testcases', label: t('hub.testcases'), count: testCases.length },
    { key: 'sprints', label: t('hub.sprints'), count: projectSprints.length },
    { key: 'issues', label: t('hub.issues'), count: issues.length },
  ];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* header */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <button onClick={() => router.push('/projects')} className="hover-surface -ml-1 grid h-7 w-7 place-items-center rounded-md text-fg-3" aria-label={t('hub.back')}>
          <ArrowLeft size={16} />
        </button>
        <span className="grid h-8 w-8 flex-none place-items-center rounded-[9px]" style={{ background: project.color }}>
          <ProjectIcon name={project.icon} size={17} />
        </span>
        <h1 className="m-0 truncate text-[18px] font-semibold tracking-tight text-fg-1">{project.name}</h1>
        <Badge tone={ps.tone} dot>{t(`projectStatus.${project.status}`)}</Badge>
      </div>

      {/* lineage + progress summary (persistent above the tabs) */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border px-6 py-3">
        <Ring value={project.progress} size={46} />
        <div className="min-w-0 flex-1">
          {release ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
              {line && <span className="text-fg-2">{line.name}</span>}
              {line && <ChevronRight size={13} className="text-fg-3" />}
              {product && <span className="text-fg-2">{product.name}</span>}
              {product && <ChevronRight size={13} className="text-fg-3" />}
              <span className="font-mono font-semibold text-fg-1">{release.name}</span>
              <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: 'var(--surface-2)', color: PROJECT_PHASE[release.phase].color }}>
                {t(`phase.${release.phase}`)}
              </span>
            </div>
          ) : (
            <div className="text-[13px] text-fg-3">{t('hub.noRelease')}</div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px] text-fg-3">
            <span className="inline-flex items-center gap-1"><Hash size={12} /> {done}/{issues.length} {t('hub.issues')}</span>
            <span className="inline-flex items-center gap-1"><Target size={12} /> {points} pts</span>
            {project.target && <span>· {project.target}</span>}
            <span className="inline-flex items-center gap-1"><Avatar person={lead} size={18} />{aiLead && <Avatar person={aiLead} size={18} />}</span>
          </div>
        </div>
      </div>

      {/* tab bar — pt gives the tabs breathing room below the summary panel */}
      <div className="flex items-center gap-5 border-b border-border px-6 pt-2.5">
        {TABS.map((tb) => (
          <TabBtn key={tb.key} active={tab === tb.key} onClick={() => setTab(tb.key)}>
            {tb.label}
            {tb.count > 0 && <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-semibold text-fg-3">{tb.count}</span>}
          </TabBtn>
        ))}
      </div>

      {/* tab content */}
      <div className="mx-auto w-full max-w-[940px] flex-1 overflow-y-auto p-6">
        {tab === 'basics' && (
          <div className="flex flex-col gap-6">
            {project.description && (
              <p className="text-[13.5px] leading-relaxed text-fg-2">{project.description}</p>
            )}
            <PrdField
              label={t('basics.summary')}
              value={project.summary ?? ''}
              placeholder={t('basics.summaryPlaceholder')}
              onSave={(v) => updateProject.mutate({ id: projectId, input: { summary: v || null } })}
            />
            <PrdField
              label={t('basics.goal')}
              value={project.goal ?? ''}
              placeholder={t('basics.goalPlaceholder')}
              onSave={(v) => updateProject.mutate({ id: projectId, input: { goal: v || null } })}
            />
            <PrdField
              label={t('basics.nonGoals')}
              value={project.nonGoals ?? ''}
              placeholder={t('basics.nonGoalsPlaceholder')}
              onSave={(v) => updateProject.mutate({ id: projectId, input: { nonGoals: v || null } })}
            />
          </div>
        )}

        {tab === 'resources' && <ResourcePanel nodeType="project" nodeId={projectId} variant="full" />}

        {tab === 'requirements' && (
          <div>
            <div className="mb-2.5 flex items-center justify-end">
              <Button variant="ghost" size="sm" onClick={() => router.push(`/requirements?project=${projectId}`)}>
                {t('requirements.title')} <ChevronsRight size={13} />
              </Button>
            </div>
            <div className="overflow-hidden rounded-[12px] border border-border">
              {canWriteRequirements && (
                <InlineCreateRow
                  label={t('requirements.new')}
                  onCreate={(title) => createReq.mutate({ projectId, title, type: 'functional', status: 'draft', releaseId: project.releaseId })}
                  className="border-b border-border"
                />
              )}
              {requirements.length === 0 ? (
                <div className="px-3 py-5 text-center text-[12.5px] text-fg-3">{t('hub.noRequirements')}</div>
              ) : (
                requirements.map((r) => (
                  <div key={r.id} className="flex items-center gap-2.5 border-b border-border bg-surface px-3 py-2 last:border-b-0">
                    <span className="h-2 w-2 flex-none rounded-full" style={{ background: REQUIREMENT_TYPE[r.type].color }} />
                    <span className="flex-none font-mono text-[11.5px] text-fg-3">{r.id}</span>
                    <EditableTitle value={r.title} onSave={(title) => updateReq.mutate({ id: r.id, input: { title } })} className="min-w-0 flex-1 text-[13px] text-fg-1" />
                    <span className="hidden text-[11.5px] tabular-nums text-fg-3 sm:inline">{t('requirements.issuesProgress', { done: r.issueStats.done, total: r.issueStats.total })}</span>
                    <Badge tone={REQUIREMENT_STATUS[r.status].tone}>{t(`reqStatus.${r.status}`)}</Badge>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'plans' && <PlansPanel projectId={projectId} />}

        {tab === 'testcases' && (
          <div>
            <div className="mb-2.5 flex items-center justify-end">
              <Button variant="ghost" size="sm" onClick={() => router.push(`/testcases?project=${projectId}`)}>
                {t('testcases.title')} <ChevronsRight size={13} />
              </Button>
            </div>
            <div className="overflow-hidden rounded-[12px] border border-border">
              {canWriteTestcases && (
                <InlineCreateRow
                  label={t('testcases.new')}
                  onCreate={(title) => createTc.mutate({ projectId, title, status: 'draft', result: 'untested', priority: 'medium' })}
                  className="border-b border-border"
                />
              )}
              {testCases.length === 0 ? (
                <div className="px-3 py-5 text-center text-[12.5px] text-fg-3">{t('testcases.empty')}</div>
              ) : (
                testCases.map((c) => (
                  <div key={c.id} className="flex items-center gap-2.5 border-b border-border bg-surface px-3 py-2 last:border-b-0">
                    <span className="h-2 w-2 flex-none rounded-full" style={{ background: TEST_RESULT[c.result].color }} />
                    <span className="flex-none font-mono text-[11.5px] text-fg-3">{c.id}</span>
                    <EditableTitle value={c.title} onSave={(title) => updateTc.mutate({ id: c.id, input: { title } })} className="min-w-0 flex-1 text-[13px] text-fg-1" />
                    {c.requirementId && <span className="hidden items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-fg-2 sm:inline-flex"><Link2 size={10} /> {c.requirementId}</span>}
                    <Badge tone={TEST_RESULT[c.result].tone}>{t(`tcResult.${c.result}`)}</Badge>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'sprints' && (
          projectSprints.length === 0 ? (
            <div className={emptyCls}>{t('hub.noSprints')}</div>
          ) : (
            <div className="flex flex-col gap-2">
              {projectSprints.map((s) => (
                <div
                  key={s.id}
                  onClick={() => router.push(`/sprints/${s.id}`)}
                  className="group flex cursor-pointer items-center gap-3 rounded-[12px] border border-border bg-surface px-3.5 py-2.5 transition-colors hover:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-medium text-fg-1">{s.name}</span>
                      <Badge tone={SPRINT_STATUS[s.status].tone} dot>{t(`sprintStatus.${s.status}`)}</Badge>
                    </div>
                    {s.goal && <div className="mt-0.5 truncate text-[12px] text-fg-3">{s.goal}</div>}
                  </div>
                  {/* stop propagation so interacting with the resource panel doesn't navigate */}
                  <div onClick={(e) => e.stopPropagation()}>
                    <ResourcePanelCompact nodeType="sprint" nodeId={s.id} variant="compact" />
                  </div>
                  <ChevronRight size={15} className="flex-none text-fg-3 opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              ))}
            </div>
          )
        )}

        {tab === 'issues' && (
          <div className="overflow-hidden rounded-[12px] border border-border">
            {canWriteIssues && (
              <InlineCreateRow
                label={t('issues.new')}
                onCreate={(title) => createIssue.mutate({ title, projectId, status: 'todo' })}
                className="border-b border-border"
              />
            )}
            {issues.length === 0 ? (
              <div className="px-3 py-5 text-center text-[12.5px] text-fg-3">{t('issues.empty')}</div>
            ) : (
              issues.map((i) => (
                <div key={i.id} onClick={() => router.push(`/issues/${encodeURIComponent(i.id)}`)} className="flex cursor-pointer items-center gap-2.5 border-b border-border bg-surface px-3 py-2 last:border-b-0 hover:bg-surface-2">
                  <StatusIcon status={i.status} size={15} />
                  <span className="flex-none font-mono text-[11.5px] text-fg-3">{i.id}</span>
                  <EditableTitle value={i.title} onSave={(title) => updateIssue.mutate({ id: i.id, input: { title } })} className="min-w-0 flex-1 text-[13px] text-fg-1" />
                  <PriorityIcon priority={i.priority} size={14} />
                  <Avatar person={memberById(i.assigneeId)} size={20} />
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
