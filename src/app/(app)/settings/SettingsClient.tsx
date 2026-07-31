'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { SegBtn } from '@/components/ui/segmented';
import { CompaniesPanel } from '@/components/platform/CompaniesPanel';
import { MembersPanel } from '@/components/platform/MembersPanel';
import { MatrixPanel } from '@/components/platform/MatrixPanel';
import { useAppData } from '@/store/AppData';
import { useT } from '@/lib/i18n';
import { applyTheme, readThemePref, type ThemePref } from '@/lib/theme';
import { cn } from '@/lib/utils';

type TabKey = 'preferences' | 'companies' | 'members' | 'matrix' | 'company-matrix';

const selectCls =
  'h-8 rounded-md border border-border-strong bg-surface px-2 text-[13px] text-fg-1 outline-none focus:border-brand-blue disabled:opacity-60';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[14px] border border-border bg-surface px-6 py-5 shadow-1">
      <h2 className="mb-2 text-[15px] font-semibold text-fg-1">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, desc, control }: { label: string; desc?: string; control: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-fg-1">{label}</div>
        {desc && <div className="mt-0.5 text-[12px] text-fg-3">{desc}</div>}
      </div>
      {control}
    </div>
  );
}

/* Toggle used by the placeholder preference switches (disabled, "coming
   soon" tooltip via the wrapping span — disabled buttons swallow events). */
function Toggle({ on, disabledTitle }: { on: boolean; disabledTitle?: string }) {
  return (
    <span title={disabledTitle} className="inline-flex">
      <button
        type="button"
        disabled={!!disabledTitle}
        className={cn(
          'relative h-[22px] w-[40px] flex-none rounded-full transition-colors disabled:cursor-not-allowed',
          on ? 'bg-brand-blue' : 'bg-surface-sunken',
        )}
        style={{ border: '1px solid var(--border-strong)' }}
      >
        <span
          className="absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white transition-all"
          style={{ left: on ? 19 : 2, boxShadow: 'var(--shadow-1)' }}
        />
      </button>
    </span>
  );
}

function PreferencesPanel() {
  const t = useT();
  // Lazy init mirrors the header toggle: this panel only renders after the
  // client session resolves, so localStorage is already readable.
  const [theme, setTheme] = React.useState<ThemePref>(() =>
    typeof window === 'undefined' ? 'light' : readThemePref(),
  );

  const changeTheme = (pref: ThemePref) => {
    setTheme(pref);
    applyTheme(pref);
  };

  const soon = t('profile.comingSoon');

  return (
    <div className="flex flex-col gap-5">
      <Card title={t('settingsPage.general')}>
        <Row
          label={t('settingsPage.language')}
          control={
            <span title={soon} className="inline-flex">
              <select className={selectCls} disabled>
                <option>简体中文</option>
              </select>
            </span>
          }
        />
        <Row
          label={t('settingsPage.timezone')}
          control={
            <span title={soon} className="inline-flex">
              <select className={selectCls} disabled>
                <option>Asia/Shanghai</option>
              </select>
            </span>
          }
        />
        <Row
          label={t('settingsPage.theme')}
          control={
            <select
              className={selectCls}
              value={theme}
              onChange={(e) => changeTheme(e.target.value as ThemePref)}
            >
              <option value="light">{t('settingsPage.themeLight')}</option>
              <option value="dark">{t('settingsPage.themeDark')}</option>
              <option value="system">{t('settingsPage.themeSystem')}</option>
            </select>
          }
        />
        <Row
          label={t('settingsPage.langSwitcher')}
          desc={t('settingsPage.langSwitcherDesc')}
          control={<Toggle on disabledTitle={soon} />}
        />
      </Card>

      <Card title={t('settingsPage.notifications')}>
        <Row
          label={t('settingsPage.inApp')}
          desc={t('settingsPage.inAppDesc')}
          control={<Toggle on disabledTitle={soon} />}
        />
        <Row
          label={t('settingsPage.emailNotif')}
          desc={t('settingsPage.emailNotifDesc')}
          control={<Toggle on={false} disabledTitle={soon} />}
        />
      </Card>

      <Card title={t('settingsPage.privacy')}>
        <Row
          label={t('settingsPage.dataExport')}
          desc={t('settingsPage.dataExportDesc')}
          control={
            <span title={soon} className="inline-flex">
              <button
                type="button"
                disabled
                className="h-8 rounded-md border border-border-strong bg-surface px-3 text-[13px] font-medium text-fg-1 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('settingsPage.requestExport')}
              </button>
            </span>
          }
        />
      </Card>
    </div>
  );
}

/* /settings — 偏好(所有用户)+ 平台管理 Tab(仅平台管理员,合并自原
   /platform 子页,旧路由重定向到这里;Agent 接入已独立为 /agent-access)。
   Tab 由路径段驱动:/settings/<tab>(缺省 preferences)。 */
export default function SettingsClient({ tab: tabProp }: { tab?: string }) {
  const t = useT();
  const router = useRouter();
  const { isPlatformAdmin, companyRole } = useAppData();

  const tabs: { key: TabKey; label: string; adminOnly?: boolean; companyAdminOnly?: boolean }[] = [
    { key: 'preferences', label: t('settingsPage.tab.preferences') },
    { key: 'companies', label: t('settingsPage.tab.companies'), adminOnly: true },
    { key: 'members', label: t('settingsPage.tab.members'), adminOnly: true },
    { key: 'matrix', label: t('settingsPage.tab.matrix'), adminOnly: true },
    { key: 'company-matrix', label: t('settingsPage.tab.companyMatrix'), companyAdminOnly: true },
  ];
  const visible = tabs.filter(
    (tab) =>
      (!tab.adminOnly || isPlatformAdmin) &&
      (!tab.companyAdminOnly || companyRole === 'company_admin' || isPlatformAdmin),
  );

  const raw = (tabProp ?? null) as TabKey | null;
  const tab: TabKey = visible.some((v) => v.key === raw) ? (raw as TabKey) : 'preferences';

  const setTab = (key: TabKey) => {
    router.replace(key === 'preferences' ? '/settings' : `/settings/${key}`, { scroll: false });
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex-none px-6 pt-6">
        <div className="mx-auto w-full max-w-[860px]">
          <h1 className="text-[22px] font-bold text-fg-1">{t('settingsPage.title')}</h1>
          <p className="mt-1 text-[13px] text-fg-3">{t('settingsPage.subtitle')}</p>
          <div className="mt-4 inline-flex items-center gap-1 rounded-lg bg-surface-2 p-1">
            {visible.map(({ key, label }) => (
              <SegBtn key={key} active={tab === key} onClick={() => setTab(key)}>
                {label}
              </SegBtn>
            ))}
          </div>
        </div>
      </div>

      {tab === 'preferences' ? (
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mx-auto max-w-[860px]">
            <PreferencesPanel />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col pt-2">
          <div className="mx-auto flex min-h-0 w-full max-w-[860px] flex-1 flex-col">
            {tab === 'companies' && <CompaniesPanel />}
            {tab === 'members' && <MembersPanel />}
            {tab === 'matrix' && <MatrixPanel scope="global" />}
            {tab === 'company-matrix' && <MatrixPanel scope="company" />}
          </div>
        </div>
      )}
    </div>
  );
}
