'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Link2, Shield, Smartphone } from 'lucide-react';
import { Avatar } from '@/components/glyphs/Avatar';
import { ChangePasswordForm } from '@/components/profile/ChangePasswordForm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SegBtn } from '@/components/ui/segmented';
import { useAppData } from '@/store/AppData';
import { ApiError, authApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { Member } from '@/lib/types';

type TabKey = 'profile' | 'security' | 'apps';

const fieldLabel = 'mb-1 block text-[12.5px] font-medium text-fg-2';

function Card({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[14px] border border-border bg-surface px-6 py-5 shadow-1">
      <div className="mb-3 flex items-center gap-2.5">
        <h2 className="flex-1 text-[15px] font-semibold text-fg-1">{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

/* Small pill for not-yet-built affordances: everything renders but stays
   disabled with the "coming soon" hint as its tooltip. The wrapping span
   carries the title because disabled buttons swallow pointer events. */
function SoonButton({ children, primary }: { children: React.ReactNode; primary?: boolean }) {
  const t = useT();
  return (
    <span title={t('profile.comingSoon')} className="inline-flex">
      <Button variant={primary ? 'primary' : 'secondary'} size="md" disabled>
        {children}
      </Button>
    </span>
  );
}

function ProfileTab() {
  const t = useT();
  const qc = useQueryClient();
  const { session, me } = useAppData();
  const user = session?.user;
  const [name, setName] = React.useState(user?.name ?? '');
  const [error, setError] = React.useState<string | null>(null);
  const [okMsg, setOkMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const person: Member | null =
    me ??
    (user
      ? {
          id: user.id,
          type: 'human',
          name: user.name,
          initials: (user.name || user.username || '?').slice(0, 2),
          color: null,
          role: null,
        }
      : null);

  const save = async () => {
    setError(null);
    setOkMsg(null);
    setBusy(true);
    try {
      await authApi.updateProfile(name.trim());
      setOkMsg(t('profile.saved'));
      // Header / sidebar / assignees all read from these two caches.
      qc.invalidateQueries({ queryKey: ['session'] });
      qc.invalidateQueries({ queryKey: ['bootstrap'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('profile.basic')}>
      {person && (
        <div className="mb-5 flex items-center gap-3">
          <Avatar person={person} size={48} />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-fg-1">{user?.name}</div>
            <div className="truncate text-[12.5px] text-fg-3">@{user?.username}</div>
          </div>
        </div>
      )}
      <div className="flex max-w-[420px] flex-col gap-4">
        <div>
          <span className={fieldLabel}>{t('settings.name')}</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <span className={fieldLabel}>{t('profile.nickname')}</span>
          <Input disabled placeholder={t('profile.comingSoon')} />
        </div>
        <div>
          <span className={fieldLabel}>{t('profile.phone')}</span>
          <Input disabled placeholder={`${t('profile.optional')} · ${t('profile.comingSoon')}`} />
        </div>
        <div>
          <span className={fieldLabel}>{t('profile.email')}</span>
          <Input disabled placeholder={t('profile.comingSoon')} />
          <div className="mt-1 text-[12px] text-fg-3">{t('profile.emailHint')}</div>
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-[12px] text-danger">{error}</span>}
          {okMsg && !error && <span className="text-[12px] text-success">{okMsg}</span>}
          <div className="flex-1" />
          <Button
            variant="primary"
            size="md"
            onClick={save}
            disabled={!name.trim() || name.trim() === user?.name || busy}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function browserSummary(): string {
  const ua = navigator.userAgent;
  const os = /Mac OS X/.test(ua)
    ? 'macOS'
    : /Windows/.test(ua)
      ? 'Windows'
      : /Linux/.test(ua)
        ? 'Linux'
        : /Android/.test(ua)
          ? 'Android'
          : /iPhone|iPad/.test(ua)
            ? 'iOS'
            : '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Safari\//.test(ua)
        ? 'Safari'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : '';
  return [os, browser].filter(Boolean).join(' · ') || '—';
}

function SecurityTab() {
  const t = useT();
  const { session } = useAppData();
  const larkBound = session?.user.larkBound ?? false;

  return (
    <>
      <Card
        title={t('profile.totp')}
        extra={
          <>
            <Badge tone="neutral">{t('profile.totpOff')}</Badge>
            <SoonButton primary>{t('profile.totpEnable')}</SoonButton>
          </>
        }
      >
        <p className="text-[13px] text-fg-2">{t('profile.totpDesc')}</p>
      </Card>

      <Card title={t('profile.password')} extra={<KeyRound size={15} className="text-fg-3" />}>
        <p className="mb-3 text-[13px] text-fg-2">{t('profile.passwordDesc')}</p>
        <div className="max-w-[420px]">
          <ChangePasswordForm />
        </div>
      </Card>

      <Card title={t('profile.boundWays')}>
        {larkBound ? (
          <div className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5">
            <Link2 size={15} className="flex-none text-fg-3" />
            <span className="text-[13px] font-medium text-fg-1">{t('profile.lark')}</span>
            <div className="flex-1" />
            <SoonButton>{t('profile.unbind')}</SoonButton>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12.5px] text-fg-3">
            {t('profile.noBound')}
          </div>
        )}
        <div className="mt-4">
          <div className="mb-2 text-[12px] text-fg-3">{t('profile.bindNew')}</div>
          <div className="flex flex-wrap gap-2">
            {['GitHub', 'Google', 'Apple', '微信', '飞书', '钉钉'].map((p) => (
              <SoonButton key={p}>{p}</SoonButton>
            ))}
          </div>
        </div>
      </Card>

      <Card title={t('profile.sessions')}>
        <div className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5">
          <Shield size={15} className="flex-none text-fg-3" />
          <span className="text-[13px] text-fg-1">{browserSummary()}</span>
          <Badge tone="blue">{t('profile.currentSession')}</Badge>
          <div className="flex-1" />
        </div>
      </Card>

      <Card title={t('profile.loginHistory')}>
        <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12.5px] text-fg-3">
          {t('profile.comingSoon')}
        </div>
      </Card>
    </>
  );
}

function AppsTab() {
  const t = useT();
  return (
    <Card title={t('profile.tab.apps')}>
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <Smartphone size={22} className="text-fg-3" />
        <div className="text-[13.5px] font-medium text-fg-1">{t('profile.appsEmpty')}</div>
        <div className="text-[12.5px] text-fg-3">{t('profile.appsEmptyBody')}</div>
      </div>
    </Card>
  );
}

/* /profile — account page replacing the old settings modal. Tabs: 资料 /
   安全 / 已授权应用. Only 姓名保存 and 修改密码 are wired to the backend;
   everything else is placeholder UI per the product design. */
export default function ProfilePage() {
  const t = useT();
  const [tab, setTab] = React.useState<TabKey>('profile');

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'profile', label: t('profile.tab.profile') },
    { key: 'security', label: t('profile.tab.security') },
    { key: 'apps', label: t('profile.tab.apps') },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[760px] flex-col gap-5 px-6 py-8">
        <div>
          <h1 className="text-[22px] font-bold text-fg-1">{t('profile.title')}</h1>
          <p className="mt-1 text-[13px] text-fg-3">{t('profile.subtitle')}</p>
        </div>

        <div className="inline-flex w-fit items-center gap-1 rounded-lg bg-surface-2 p-1">
          {tabs.map(({ key, label }) => (
            <SegBtn key={key} active={tab === key} onClick={() => setTab(key)}>
              {label}
            </SegBtn>
          ))}
        </div>

        {tab === 'profile' && <ProfileTab />}
        {tab === 'security' && (
          <div className="flex flex-col gap-5">
            <SecurityTab />
          </div>
        )}
        {tab === 'apps' && <AppsTab />}
      </div>
    </div>
  );
}
