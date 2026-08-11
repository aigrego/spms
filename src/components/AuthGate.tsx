'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { HEADER_HEIGHT } from '@/components/Header';
import { Skeleton } from '@/components/StateBlock';
import { useAppData } from '@/store/AppData';
import type { ModuleKey } from '@/lib/api';

/* Client-side auth fallback: middleware already redirects when the session
   cookie is absent; this catches an invalid/expired cookie (session check
   returns null) and bounces to /login.

   P5 adds RBAC route guards on top: a path whose module the user cannot read
   redirects to the first readable module (issues first), and /platform/** is
   platform-admin only. Permissions fail open while the backend rolls out, so
   the guards are inert until the session carries a permissions map. */

const PATH_MODULE: [string, ModuleKey][] = [
  ['/issues', 'issues'],
  ['/products', 'products'],
  ['/requirements', 'requirements'],
  ['/testcases', 'testcases'],
  ['/projects', 'projects'],
  ['/resources', 'resources'],
  ['/roadmap', 'roadmap'],
  // 团队总结与日报共享 reports 模块权限门。
  ['/summary', 'reports'],
  ['/backlog', 'backlog'],
  ['/sprints', 'sprints'],
  ['/reports', 'reports'],
];

// Redirect preference order when the current module is not readable.
const MODULE_ORDER: { key: ModuleKey; path: string }[] = [
  { key: 'issues', path: '/issues' },
  { key: 'products', path: '/products' },
  { key: 'requirements', path: '/requirements' },
  { key: 'testcases', path: '/testcases' },
  { key: 'projects', path: '/projects' },
  { key: 'resources', path: '/resources' },
  { key: 'roadmap', path: '/roadmap' },
  { key: 'backlog', path: '/backlog' },
  { key: 'sprints', path: '/sprints' },
  { key: 'reports', path: '/reports' },
];

function GateSkeleton() {
  return (
    <div className="flex h-screen flex-col bg-bg">
      <div className="flex-none border-b border-border bg-surface" style={{ height: HEADER_HEIGHT }} />
      <div className="flex min-h-0 flex-1">
        <div className="w-[244px] flex-none border-r border-border bg-surface-2" />
        <div className="flex-1">
          <Skeleton rows={9} />
        </div>
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, sessionLoading, can, isPlatformAdmin } = useAppData();

  const moduleKey = PATH_MODULE.find(([p]) => pathname.startsWith(p))?.[1] ?? null;
  const isPlatformPath = pathname.startsWith('/platform');
  const firstReadable = MODULE_ORDER.find((m) => can(m.key, 'read'))?.path ?? null;

  const blockedPlatform = isPlatformPath && !isPlatformAdmin;
  const blockedModule = moduleKey != null && !can(moduleKey, 'read');

  React.useEffect(() => {
    if (sessionLoading) return;
    if (!session) {
      router.replace('/login');
      return;
    }
    if ((blockedPlatform || blockedModule) && firstReadable && firstReadable !== pathname) {
      router.replace(firstReadable);
    }
  }, [sessionLoading, session, blockedPlatform, blockedModule, firstReadable, pathname, router]);

  if (sessionLoading || !session) return <GateSkeleton />;
  // Don't flash forbidden content while the redirect above fires.
  if ((blockedPlatform || blockedModule) && firstReadable) return <GateSkeleton />;
  return <>{children}</>;
}
