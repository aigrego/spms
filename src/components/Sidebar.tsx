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

/* 左侧菜单的快捷筛选项:整行即触发器,点击向右弹出筛选框(全部 + 条目列表);
   选中写入页面内同一个浏览器记忆 key 并跳转对应页面 —— 与页面工具栏的筛选是
   同一状态、两处入口。右侧常驻 chevron;筛选生效时换成选中条目的彩色图标。 */
function FilterNavItem({
  active,
  icon,
  label,
  title,
  prefKey,
  items,
  navigateTo,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  title: string;
  prefKey: string;
  items: { id: string; name: string; color: string; icon: string }[];
  navigateTo: string;
}) {
  const t = useT();
  const router = useRouter();
  const [value, setValue] = usePersistentState<string>(prefKey, 'all', isStr);
  const [open, setOpen] = React.useState(false);
  // 失效自愈:指向已删除/其他公司条目的筛选按 'all' 处理。
  const activeItem = value !== 'all' ? items.find((i) => i.id === value) : undefined;
  const effective = activeItem ? activeItem.id : 'all';

  const pick = (id: string) => {
    setValue(id);
    setOpen(false);
    router.push(navigateTo);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          title={title}
          className={cn(
            'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 text-left text-[13.5px] transition-colors',
            active ? 'font-semibold text-brand-blue' : 'font-medium text-fg-2 hover:bg-surface-2',
          )}
          style={active ? { background: 'var(--brand-blue-tint-8)' } : undefined}
        >
          <span style={{ color: active ? 'var(--brand-blue)' : 'var(--fg-3)' }}>{icon}</span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {activeItem ? (
            <span
              className="grid h-4 w-4 flex-none place-items-center rounded"
              style={{ background: activeItem.color }}
            >
              <ProjectIcon name={activeItem.icon} size={10} />
            </span>
          ) : (
            <ChevronDown size={14} className="flex-none text-fg-3" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" style={{ width: 220 }}>
        <MenuItem label={t('common.all')} selected={effective === 'all'} onClick={() => pick('all')} />
        {items.map((p) => (
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
  );
}

/* Sidebar sits under the global header (AppShell owns the column layout), so
   it fills the remaining height instead of h-screen. Nav entries are filtered
   by the company-scoped RBAC permissions (P5): an entry needs read access to
   its module, and a section label is hidden when its whole group is gone. */
export function Sidebar({ myCount }: { myCount: number }) {
  const { can, projects, products } = useAppData();
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
            {/* 全部 Issues 的按项目快捷筛选:与页面工具栏筛选同一 key。 */}
            <FilterNavItem
              active={isAllIssues}
              icon={<Inbox size={16} />}
              label={t('nav.allIssues')}
              title={t('nav.filterProjects')}
              prefKey="issues.projectFilter"
              items={projects}
              navigateTo="/issues"
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
              {/* 项目的按产品快捷筛选:与页面工具栏筛选同一 key。 */}
              {showProjects && (
                <FilterNavItem
                  active={pathname.startsWith('/projects')}
                  icon={<Box size={16} />}
                  label={t('nav.projects')}
                  title={t('nav.filterProducts')}
                  prefKey="projects.productFilter"
                  items={products}
                  navigateTo="/projects"
                />
              )}
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
