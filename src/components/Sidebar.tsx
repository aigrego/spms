'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutGrid,
  Box,
  Map,
  ListTodo,
  Target,
  Layers,
  FileText,
  Users,
  FlaskConical,
  Inbox,
  Settings,
  KeyRound,
  Plug,
  BarChart3,
  Compass,
  ChevronDown,
} from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent, MenuItem } from '@/components/ui/popover';
import { ProjectIcon } from '@/components/glyphs/misc';
import { usePersistentState } from '@/lib/prefs';
import { useAppData } from '@/store/AppData';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const isStr = (v: unknown): v is string => typeof v === 'string';

function NavItem({
  icon,
  label,
  count,
  active,
  indent,
  href,
}: {
  icon?: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  indent?: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-md py-1.5 text-[13.5px] transition-colors',
        indent ? 'pl-[30px] pr-2' : 'px-2',
        active
          ? 'font-semibold text-brand-blue'
          : 'font-medium text-fg-2 hover:bg-surface-2',
      )}
      style={active ? { background: 'var(--brand-blue-tint-8)' } : undefined}
    >
      {icon && (
        <span style={{ color: active ? 'var(--brand-blue)' : 'var(--fg-3)' }}>{icon}</span>
      )}
      <span className="flex-1 truncate">{label}</span>
      {count != null && (
        <span className="min-w-[18px] rounded-full bg-surface-2 px-[7px] text-center text-[11px] font-semibold text-fg-3">
          {count}
        </span>
      )}
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-0 mb-1 mt-3.5 flex items-center justify-between px-2">
      <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-fg-3">
        {children}
      </span>
    </div>
  );
}

/* 项目菜单项:Link + 右侧筛选触发钮(hover 淡入,弹层打开或筛选生效时常驻,
   生效中显示选中项目的彩色图标)。筛选框向右弹出:全部 + 未归档项目;选中写入
   浏览器记忆(projects.navFilter)并跳 /projects,该项目页共用同一 key。 */
function ProjectsNavItem({ active }: { active: boolean }) {
  const t = useT();
  const router = useRouter();
  const { projects } = useAppData();
  const [navFilter, setNavFilter] = usePersistentState<string>('projects.navFilter', 'all', isStr);
  const [open, setOpen] = React.useState(false);
  // 失效自愈:指向已删除/其他公司项目的筛选按 'all' 处理。
  const activeProject = navFilter !== 'all' ? projects.find((p) => p.id === navFilter) : undefined;
  const effective = activeProject ? activeProject.id : 'all';
  const list = projects.filter((p) => !p.archivedAt);

  const pick = (id: string) => {
    setNavFilter(id);
    setOpen(false);
    router.push('/projects');
  };

  return (
    <div className="group flex items-center">
      <Link
        href="/projects"
        className={cn(
          'flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md py-1 pl-2 pr-1 text-[13.5px] transition-colors',
          active ? 'font-semibold text-brand-blue' : 'font-medium text-fg-2 hover:bg-surface-2',
        )}
        style={active ? { background: 'var(--brand-blue-tint-8)' } : undefined}
      >
        <span style={{ color: active ? 'var(--brand-blue)' : 'var(--fg-3)' }}>
          <Box size={16} />
        </span>
        <span className="flex-1 truncate">{t('nav.projects')}</span>
      </Link>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            title={t('nav.filterProjects')}
            className={cn(
              'mr-1 grid h-5 w-5 flex-none place-items-center rounded text-fg-3 transition-opacity hover:bg-surface-sunken hover:text-fg-1',
              open || effective !== 'all' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            {activeProject ? (
              <span className="grid h-4 w-4 place-items-center rounded" style={{ background: activeProject.color }}>
                <ProjectIcon name={activeProject.icon} size={10} />
              </span>
            ) : (
              <ChevronDown size={14} />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" style={{ width: 220 }}>
          <MenuItem label={t('common.all')} selected={effective === 'all'} onClick={() => pick('all')} />
          {list.map((p) => (
            <MenuItem
              key={p.id}
              glyph={
                <span className="grid h-4 w-4 flex-none place-items-center rounded" style={{ background: p.color }}>
                  <ProjectIcon name={p.icon} size={11} />
                </span>
              }
              label={p.name}
              selected={effective === p.id}
              onClick={() => pick(p.id)}
            />
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* Sidebar sits under the global header (AppShell owns the column layout), so
   it fills the remaining height instead of h-screen. Nav entries are filtered
   by the company-scoped RBAC permissions (P5): an entry needs read access to
   its module, and a section label is hidden when its whole group is gone. */
export function Sidebar({ myCount }: { myCount: number }) {
  const { can } = useAppData();
  const t = useT();
  const pathname = usePathname();

  const isMyIssues = pathname === '/my-issues' || pathname.startsWith('/my-issues/');
  const isAllIssues = pathname === '/issues' || pathname.startsWith('/issues/');

  const showIssues = can('issues', 'read');
  const showProducts = can('products', 'read');
  const showRequirements = can('requirements', 'read');
  const showTestcases = can('testcases', 'read');
  const showProjects = can('projects', 'read');
  const showResources = can('resources', 'read');
  const showRoadmap = can('roadmap', 'read');
  // 团队总结与日报共享 reports 模块权限门。
  const showSummary = can('reports', 'read');
  const showBacklog = can('backlog', 'read');
  const showSprints = can('sprints', 'read');

  const showLifecycle = showProducts || showRequirements || showTestcases;
  // 生命周期指引(/guide)无权限门、对所有登录用户可见,工作区区块因此恒展示。
  const showWorkspace = true;
  const showScrum = showBacklog || showSprints;

  return (
    <aside className="flex w-[244px] flex-none flex-col overflow-hidden border-r border-border bg-surface-2">
      <div className="flex-1 overflow-y-auto px-3 pb-3 pt-3">
        {showIssues && (
          <div className="mt-1 flex flex-col gap-px">
            <NavItem
              icon={<LayoutGrid size={16} />}
              label={t('nav.myIssues')}
              count={myCount}
              active={isMyIssues}
              href="/my-issues"
            />
            <NavItem
              icon={<Inbox size={16} />}
              label={t('nav.allIssues')}
              active={isAllIssues}
              href="/issues"
            />
          </div>
        )}

        {showLifecycle && (
          <>
            <SectionLabel>{t('nav.section.lifecycle')}</SectionLabel>
            <div className="flex flex-col gap-px">
              {showProducts && (
                <NavItem
                  icon={<Layers size={16} />}
                  label={t('nav.products')}
                  active={pathname.startsWith('/products')}
                  href="/products"
                />
              )}
              {showRequirements && (
                <NavItem
                  icon={<FileText size={16} />}
                  label={t('nav.requirements')}
                  active={pathname.startsWith('/requirements')}
                  href="/requirements"
                />
              )}
              {showTestcases && (
                <NavItem
                  icon={<FlaskConical size={16} />}
                  label={t('nav.testcases')}
                  active={pathname.startsWith('/testcases')}
                  href="/testcases"
                />
              )}
            </div>
          </>
        )}

        {showWorkspace && (
          <>
            <SectionLabel>{t('nav.section.workspace')}</SectionLabel>
            <div className="flex flex-col gap-px">
              <NavItem
                icon={<Compass size={16} />}
                label={t('nav.guide')}
                active={pathname.startsWith('/guide')}
                href="/guide"
              />
              {showProjects && <ProjectsNavItem active={pathname.startsWith('/projects')} />}
              {showResources && (
                <NavItem
                  icon={<Users size={16} />}
                  label={t('nav.resources')}
                  active={pathname.startsWith('/resources')}
                  href="/resources"
                />
              )}
              {showRoadmap && (
                <NavItem
                  icon={<Map size={16} />}
                  label={t('nav.roadmap')}
                  active={pathname.startsWith('/roadmap')}
                  href="/roadmap"
                />
              )}
              {showSummary && (
                <NavItem
                  icon={<BarChart3 size={16} />}
                  label={t('nav.summary')}
                  active={pathname.startsWith('/summary')}
                  href="/summary"
                />
              )}
            </div>
          </>
        )}

        {showScrum && (
          <>
            <SectionLabel>{t('nav.section.scrum')}</SectionLabel>
            <div className="flex flex-col gap-px">
              {showBacklog && (
                <NavItem
                  icon={<ListTodo size={16} />}
                  label={t('nav.backlog')}
                  active={pathname.startsWith('/backlog')}
                  href="/backlog"
                />
              )}
              {showSprints && (
                <NavItem
                  icon={<Target size={16} />}
                  label={t('nav.sprints')}
                  active={pathname.startsWith('/sprints')}
                  href="/sprints"
                />
              )}
            </div>
          </>
        )}

        {/* AI Agents 区块暂时隐藏:这里原展示 4 个内置 agent 成员(atlas/forge/
            sentry/scribe),与 MCP 对接配置(/agent-access 独立页面)无关,
            后续需要时恢复。 */}
      </div>

      {/* Bottom: agent access + Notion 集成(按 notion 模块权限显隐)+ settings。 */}
      <div className="flex-none border-t border-border px-3 py-2">
        <div className="flex flex-col gap-px">
          <NavItem
            icon={<KeyRound size={16} />}
            label={t('nav.agentAccess')}
            active={pathname.startsWith('/agent-access')}
            href="/agent-access"
          />
          {can('notion', 'read') && (
            <NavItem
              icon={<Plug size={16} />}
              label={t('nav.notionIntegration')}
              active={pathname.startsWith('/integrations')}
              href="/integrations"
            />
          )}
          <NavItem
            icon={<Settings size={16} />}
            label={t('nav.settings')}
            active={pathname.startsWith('/settings')}
            href="/settings"
          />
        </div>
      </div>
    </aside>
  );
}
