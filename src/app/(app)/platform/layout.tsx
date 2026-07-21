'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, Users, Grid3x3, KeyRound } from 'lucide-react';

/* /platform 二级导航 — 平台管理区（公司 / 成员 / 权限矩阵 / API Keys）。
   外层 AppShell 提供主侧栏，这里只渲染区内导航 + 内容区。 */

const NAV = [
  { href: '/platform/companies', label: '公司', icon: Building2 },
  { href: '/platform/members', label: '成员', icon: Users },
  { href: '/platform/matrix', label: '权限矩阵', icon: Grid3x3 },
  { href: '/platform/keys', label: 'API Keys', icon: KeyRound },
];

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full min-w-0 flex-1">
      <nav className="flex w-[180px] flex-none flex-col gap-0.5 border-r border-border bg-surface-2 px-2.5 py-4">
        <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-fg-3">平台管理</div>
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors"
              style={{
                background: active ? 'var(--surface)' : 'transparent',
                boxShadow: active ? 'var(--shadow-1)' : 'none',
                color: active ? 'var(--fg-1)' : 'var(--fg-2)',
              }}
            >
              <Icon size={14} className="flex-none" style={{ color: active ? 'var(--brand-blue)' : 'var(--fg-3)' }} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
