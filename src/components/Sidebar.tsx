'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid,
  Box,
  Map,
  ListTodo,
  Target,
  Layers,
  FileText,
  NotebookPen,
  Users,
  FlaskConical,
  Inbox,
  Settings,
  KeyRound,
  Plug,
} from 'lucide-react';
import { useAppData } from '@/store/AppData';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

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
  const showBacklog = can('backlog', 'read');
  const showSprints = can('sprints', 'read');
  const showReports = can('reports', 'read');

  const showLifecycle = showProducts || showRequirements || showTestcases;
  const showWorkspace = showProjects || showResources || showRoadmap;
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

        {showReports && (
          <div className="mt-1 flex flex-col gap-px">
            <NavItem
              icon={<NotebookPen size={16} />}
              label={t('nav.reports')}
              active={pathname.startsWith('/reports')}
              href="/reports"
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
              {showProjects && (
                <NavItem
                  icon={<Box size={16} />}
                  label={t('nav.projects')}
                  active={pathname.startsWith('/projects')}
                  href="/projects"
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

      {/* Bottom: agent access + settings, visible to every signed-in user. */}
      <div className="flex-none border-t border-border px-3 py-2">
        <div className="flex flex-col gap-px">
          <NavItem
            icon={<KeyRound size={16} />}
            label={t('nav.agentAccess')}
            active={pathname.startsWith('/agent-access')}
            href="/agent-access"
          />
          <NavItem
            icon={<Plug size={16} />}
            label={t('nav.notionIntegration')}
            active={pathname.startsWith('/integrations')}
            href="/integrations"
          />
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
