'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { SegBtn } from '@/components/ui/segmented';
import { Toggle } from '@/components/ui/toggle';
import { CompaniesPanel } from '@/components/platform/CompaniesPanel';
import { MembersPanel } from '@/components/platform/MembersPanel';
import { MatrixPanel } from '@/components/platform/MatrixPanel';
import { OAuthProvidersPanel } from '@/components/platform/OAuthProvidersPanel';
import { StoragePanel } from '@/components/settings/StoragePanel';
import { StorageInfoCard } from '@/components/settings/StorageInfoCard';
import { Card, Row } from '@/components/settings/common';
import { useAppData } from '@/store/AppData';
import { useT, useLocale, useSetLocale, type Locale } from '@/lib/i18n';
import { usePersistentState } from '@/lib/prefs';
import { applyTheme, readThemePref, type ThemePref } from '@/lib/theme';

type TabKey = 'preferences' | 'companies' | 'members' | 'matrix' | 'oauth' | 'company-matrix' | 'platform-storage';

const selectCls =
  'h-8 rounded-md border border-border-strong bg-surface px-2 text-[13px] text-fg-1 outline-none focus:border-brand-blue disabled:opacity-60';

function PreferencesPanel() {
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();
  // 存储状态卡与 GET /pms/storage-config 的 gate 一致:平台管理员或公司管理员可见。
  const { isPlatformAdmin, companyRole } = useAppData();
  // 顶栏语言切换器的显隐属于浏览器记忆(TKT-27),随「重置浏览器记忆」一起清。
  const [showLangSwitcher, setShowLangSwitcher] = usePersistentState('showLangSwitcher', true);
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
            <select
              className={selectCls}
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
            >
              <option value="zh-CN">{t('lang.zh-CN')}</option>
              <option value="en">{t('lang.en')}</option>
              <option value="zh-TW">{t('lang.zh-TW')}</option>
            </select>
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
          control={<Toggle on={showLangSwitcher} onToggle={() => setShowLangSwitcher((v) => !v)} />}
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

      {(isPlatformAdmin || companyRole === 'company_admin') && <StorageInfoCard />}
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
    { key: 'oauth', label: t('settingsPage.tab.oauth'), adminOnly: true },
    { key: 'platform-storage', label: t('settingsPage.tab.platformStorage'), adminOnly: true },
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
            {tab === 'oauth' && <OAuthProvidersPanel />}
            {tab === 'company-matrix' && <MatrixPanel scope="company" />}
            {tab === 'platform-storage' && <StoragePanel />}
          </div>
        </div>
      )}
    </div>
  );
}
