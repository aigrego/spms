'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Search,
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
} from 'lucide-react';
import { Avatar } from '@/components/glyphs/Avatar';
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

export function Sidebar({
  onOpenCmd,
  myCount,
}: {
  onOpenCmd: () => void;
  myCount: number;
}) {
  const { agents } = useAppData();
  const t = useT();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isMyIssues = pathname === '/issues' && searchParams.get('assignee') === 'me';
  const isAllIssues = pathname === '/issues' && !isMyIssues;

  return (
    <aside className="flex h-screen w-[244px] flex-none flex-col overflow-hidden border-r border-border bg-surface-2">
      {/* Search */}
      <div className="px-3 pb-1 pt-3">
        <button
          onClick={onOpenCmd}
          className="flex h-8 w-full items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-[13px] text-fg-3"
        >
          <Search size={14} />
          <span className="flex-1 text-left">{t('common.searchJump')}</span>
          <kbd className="rounded border border-border bg-surface-2 px-[5px] py-px font-mono text-[11px]">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 pt-1.5">
        <div className="mt-1 flex flex-col gap-px">
          <NavItem
            icon={<LayoutGrid size={16} />}
            label={t('nav.myIssues')}
            count={myCount}
            active={isMyIssues}
            href="/issues?assignee=me"
          />
          <NavItem
            icon={<Inbox size={16} />}
            label={t('nav.allIssues')}
            active={isAllIssues}
            href="/issues"
          />
        </div>

        <SectionLabel>{t('nav.section.lifecycle')}</SectionLabel>
        <div className="flex flex-col gap-px">
          <NavItem
            icon={<Layers size={16} />}
            label={t('nav.products')}
            active={pathname.startsWith('/products')}
            href="/products"
          />
          <NavItem
            icon={<FileText size={16} />}
            label={t('nav.requirements')}
            active={pathname.startsWith('/requirements')}
            href="/requirements"
          />
          <NavItem
            icon={<FlaskConical size={16} />}
            label={t('nav.testcases')}
            active={pathname.startsWith('/testcases')}
            href="/testcases"
          />
        </div>

        <SectionLabel>{t('nav.section.workspace')}</SectionLabel>
        <div className="flex flex-col gap-px">
          <NavItem
            icon={<Box size={16} />}
            label={t('nav.projects')}
            active={pathname.startsWith('/projects')}
            href="/projects"
          />
          <NavItem
            icon={<Users size={16} />}
            label={t('nav.resources')}
            active={pathname.startsWith('/resources')}
            href="/resources"
          />
          <NavItem
            icon={<Map size={16} />}
            label={t('nav.roadmap')}
            active={pathname.startsWith('/roadmap')}
            href="/roadmap"
          />
        </div>

        <SectionLabel>{t('nav.section.scrum')}</SectionLabel>
        <div className="flex flex-col gap-px">
          <NavItem
            icon={<ListTodo size={16} />}
            label={t('nav.backlog')}
            active={pathname.startsWith('/backlog')}
            href="/backlog"
          />
          <NavItem
            icon={<Target size={16} />}
            label={t('nav.sprints')}
            active={pathname.startsWith('/sprints')}
            href="/sprints"
          />
        </div>

        <SectionLabel>AI Agents</SectionLabel>
        <div className="flex flex-col gap-px">
          {agents.map((ag) => (
            <a
              key={ag.id}
              className="hover-surface flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5"
            >
              <Avatar person={ag} size={20} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-fg-2">{ag.name}</div>
              </div>
              <span className="h-1.5 w-1.5 flex-none rounded-full bg-success" />
            </a>
          ))}
        </div>
      </div>
    </aside>
  );
}
