'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Languages, LogOut, NotebookPen, Search, Settings, Shield, Sun } from 'lucide-react';
import { Avatar } from '@/components/glyphs/Avatar';
import { Logo } from '@/components/Logo';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useShell } from '@/components/AppShell';
import { useAppData } from '@/store/AppData';
import { authApi, type CompanyRole, type SessionCompany } from '@/lib/api';
import { useT, useLocale, useSetLocale, type Locale } from '@/lib/i18n';
import { usePersistentState } from '@/lib/prefs';
import { applyTheme } from '@/lib/theme';
import type { Member } from '@/lib/types';
import { cn } from '@/lib/utils';

export const HEADER_HEIGHT = 52;

function roleLabel(t: (k: string) => string, role: CompanyRole | null): string | null {
  return role ? t(`role.${role}`) : null;
}

/* Colored square with the company's first letter — the visual anchor of the
   company switcher. */
function CompanyMark({ company, size = 20 }: { company: SessionCompany; size?: number }) {
  return (
    <span
      className="grid flex-none place-items-center rounded-[6px] font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.52,
        background: company.color || 'var(--slate-500)',
      }}
    >
      {(company.name || company.key || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

function CompanySwitcher() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const { companies, currentCompany, isPlatformAdmin } = useAppData();
  const [open, setOpen] = React.useState(false);
  const [switching, setSwitching] = React.useState(false);

  const switchCompany = async (companyId: string) => {
    if (switching || companyId === currentCompany?.id) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      await authApi.switchCompany(companyId);
    } catch {
      // Backend not ready / failed — keep the current company.
    }
    // Every cached query is company-scoped: drop the whole cache, then let
    // the server components re-render against the new company.
    qc.clear();
    setOpen(false);
    setSwitching(false);
    router.refresh();
  };

  /* 单公司:渲染为纯公司名(保留颜色块),无 chevron、不可点击、不出下拉。
     角色徽章只保留在用户菜单里,此处不重复展示。 */
  if (companies.length <= 1) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-8 min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-2 text-[13px] font-medium text-fg-1">
          {currentCompany ? (
            <>
              <CompanyMark company={currentCompany} size={18} />
              <span className="max-w-[160px] truncate">{currentCompany.name}</span>
            </>
          ) : (
            <span className="max-w-[160px] truncate text-fg-3">{t('header.noCompany')}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="flex h-8 min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-2 text-[13px] font-medium text-fg-1 hover:bg-surface-2"
            title={t('header.switchCompany')}
          >
            {currentCompany ? (
              <>
                <CompanyMark company={currentCompany} size={18} />
                <span className="max-w-[160px] truncate">{currentCompany.name}</span>
              </>
            ) : (
              <span className="max-w-[160px] truncate text-fg-3">{t('header.noCompany')}</span>
            )}
            <ChevronDown size={14} className="flex-none text-fg-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent style={{ width: 240 }} align="start">
          <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
            {t('header.switchCompany')}
          </div>
          {companies.length === 0 && (
            <div className="px-2.5 py-2 text-[12.5px] text-fg-3">{t('header.noCompany')}</div>
          )}
          {companies.map((c) => (
            <div
              key={c.id}
              onClick={() => switchCompany(c.id)}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-fg-1 hover:bg-surface-2',
                switching && 'pointer-events-none opacity-60',
              )}
            >
              <CompanyMark company={c} size={18} />
              <span className="flex-1 truncate">{c.name}</span>
              {c.id === currentCompany?.id && <Check size={14} style={{ color: 'var(--brand-blue)' }} />}
            </div>
          ))}
          {isPlatformAdmin && (
            <>
              <div className="mx-1 my-1 h-px bg-border" />
              <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
                {t('header.companyAdmin')}
              </div>
              <div
                onClick={() => {
                  setOpen(false);
                  router.push('/settings/companies');
                }}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-fg-1 hover:bg-surface-2"
              >
                <Shield size={15} className="flex-none text-fg-3" />
                <span className="flex-1 truncate">{t('header.platform')}</span>
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* 语言切换器(TKT-27):顶栏左侧的小地球按钮,弹出 简体中文/English/繁體中文
   菜单,选择即持久化(localStorage `spms.locale`)。可在 设置→偏好 里关掉。 */
const LOCALE_OPTIONS: Locale[] = ['zh-CN', 'en', 'zh-TW'];

function LanguageSwitcher() {
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="grid h-8 w-8 flex-none place-items-center rounded-lg border border-border bg-surface text-fg-2 hover:bg-surface-2"
          title={t('header.language')}
          aria-label={t('header.language')}
        >
          <Languages size={15} />
        </button>
      </PopoverTrigger>
      <PopoverContent style={{ width: 168 }} align="start">
        <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
          {t('header.language')}
        </div>
        {LOCALE_OPTIONS.map((l) => (
          <div
            key={l}
            onClick={() => {
              setLocale(l);
              setOpen(false);
            }}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-fg-1 hover:bg-surface-2"
          >
            <span className="flex-1 truncate">{t(`lang.${l}`)}</span>
            {l === locale && <Check size={14} style={{ color: 'var(--brand-blue)' }} />}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/* Small light/dark toggle rendered inside the user menu. */
function ThemeSwitch({ light }: { light: boolean }) {
  return (
    <span
      className={cn(
        'relative h-[18px] w-[32px] flex-none rounded-full transition-colors',
        light ? 'bg-brand-blue' : 'bg-surface-sunken',
      )}
      style={{ border: '1px solid var(--border-strong)' }}
    >
      <span
        className="absolute top-[2px] h-[12px] w-[12px] rounded-full bg-white transition-all"
        style={{ left: light ? 16 : 2, boxShadow: 'var(--shadow-1)' }}
      />
    </span>
  );
}

function UserMenu() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const { session, companyRole, me, can } = useAppData();
  // Lazy init is safe here: the user menu only renders after the client-side
  // session query resolves (never during SSR), and the anti-flash inline
  // script has already applied the persisted theme by then.
  const [light, setLight] = React.useState(
    () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light',
  );

  const toggleTheme = () => {
    const next = !light;
    applyTheme(next ? 'light' : 'dark');
    setLight(next);
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      // even a failed logout call drops the client into the login flow below
    }
    qc.clear();
    router.replace('/login');
  };

  if (!session) return null;
  const { user } = session;
  // Prefer the bootstrap member (correct color/initials); fall back to a
  // synthetic member built from the session user.
  const person: Member =
    me ?? {
      id: user.id,
      type: 'human',
      name: user.name,
      initials: (user.name || user.username || '?').slice(0, 2),
      color: null,
      role: null,
      avatarUrl: user.avatarUrl ?? null,
    };
  const role = roleLabel(t, companyRole);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex h-8 items-center gap-2 rounded-lg px-1.5 hover:bg-surface-2">
            <Avatar person={person} size={24} />
            <span className="max-w-[120px] truncate text-[13px] font-medium text-fg-1">
              {user.name}
            </span>
            <ChevronDown size={14} className="flex-none text-fg-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent style={{ width: 232 }}>
          <DropdownMenuLabel className="flex items-center gap-2.5">
            <Avatar person={person} size={30} />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-fg-1">{user.name}</div>
              <div className="truncate text-[11.5px] text-fg-3">@{user.username}</div>
              {role && (
                <Badge tone="blue" className="mt-1">
                  {role}
                </Badge>
              )}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {can('reports', 'read') && (
            <DropdownMenuItem onSelect={() => router.push('/reports')}>
              <NotebookPen size={15} className="flex-none text-fg-3" />
              {t('nav.reports')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => router.push('/profile')}>
            <Settings size={15} className="flex-none text-fg-3" />
            {t('header.settings')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={(e) => e.preventDefault()} onClick={toggleTheme}>
            <Sun size={15} className="flex-none text-fg-3" />
            <span className="flex-1">{t('header.lightMode')}</span>
            <ThemeSwitch light={light} />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={logout}
            className="text-danger data-[highlighted]:bg-surface-2"
          >
            <LogOut size={15} className="flex-none" />
            {t('header.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/* Global 52px header: logo + company switcher on the left, centered command
   palette trigger, user menu on the right. Session not ready → skeleton. */
export function Header() {
  const t = useT();
  const { openCmd } = useShell();
  const { session, sessionLoading } = useAppData();
  const [showLangSwitcher] = usePersistentState('showLangSwitcher', true);

  return (
    <header
      className="relative z-30 flex flex-none items-center gap-3 border-b border-border bg-surface px-4"
      style={{ height: HEADER_HEIGHT }}
    >
      {/* Left: logo + company switcher */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Link href="/issues" className="flex flex-none items-center gap-2 whitespace-nowrap">
          <Logo size={22} />
          <span className="flex items-baseline gap-1">
            <span className="text-[15px] font-bold tracking-tight text-fg-1">AI Grego</span>
            <span className="text-[15px] font-semibold tracking-tight text-fg-3">Track</span>
          </span>
        </Link>
        {sessionLoading || !session ? (
          <div className="skeleton h-8 w-[160px] rounded-lg" />
        ) : (
          <CompanySwitcher />
        )}
        {showLangSwitcher && <LanguageSwitcher />}
      </div>

      {/* Center: command palette trigger styled as a search box */}
      <div className="flex w-full max-w-xl flex-none justify-center">
        <button
          onClick={openCmd}
          className="flex h-8 w-full items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 text-[13px] text-fg-3 transition-colors hover:border-border-strong"
        >
          <Search size={14} className="flex-none" />
          <span className="flex-1 truncate text-left">{t('common.searchJump')}</span>
          <kbd className="rounded border border-border bg-surface px-[5px] py-px font-mono text-[11px]">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right: user menu */}
      <div className="flex min-w-0 flex-1 items-center justify-end">
        {sessionLoading || !session ? (
          <div className="skeleton h-8 w-[120px] rounded-lg" />
        ) : (
          <UserMenu />
        )}
      </div>
    </header>
  );
}
