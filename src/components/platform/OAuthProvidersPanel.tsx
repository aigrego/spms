'use client';

import * as React from 'react';
import { Check, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton, StateBlock } from '@/components/StateBlock';
import { PlatformHeader, PopoverConfirm, fieldLabel, inputCls } from '@/components/platform/common';
import { useDeleteOAuthProvider, useOAuthProviders, useSaveOAuthProvider } from '@/store/platform';
import type { OAuthProviderConf } from '@/lib/platformApi';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/* 设置 → 三方登录（平台管理员）：飞书/Lark/GitHub 登录凭据的 DB 配置。
   DB 行优先，env 兜底；secret 加密落库、永不回显（留空 = 保留旧值）。 */

type ProviderKey = 'feishu' | 'lark' | 'github';

const PROVIDER_LABEL: Record<ProviderKey, string> = {
  feishu: '飞书',
  lark: 'Lark',
  github: 'GitHub',
};

interface Draft {
  appId: string;
  appSecret: string; // 只存用户输入；空串 = 不修改
  redirectUri: string;
  enabled: boolean;
}

function draftOf(conf: OAuthProviderConf): Draft {
  return {
    appId: conf.appId ?? '',
    appSecret: '',
    redirectUri: conf.redirectUri ?? '',
    enabled: conf.enabled ?? true,
  };
}

function SourceBadge({ source }: { source: OAuthProviderConf['source'] }) {
  const t = useT();
  const [text, cls] =
    source === 'db'
      ? [t('oauth.sourceDb'), 'bg-brand-blue/10 text-brand-blue']
      : source === 'env'
        ? [t('oauth.sourceEnv'), 'bg-surface-2 text-fg-3']
        : [t('oauth.notConfigured'), 'bg-surface-2 text-fg-3'];
  return <span className={cn('rounded-full px-2 py-px text-[11.5px] font-semibold', cls)}>{text}</span>;
}

function ProviderCard({ conf }: { conf: OAuthProviderConf }) {
  const t = useT();
  const save = useSaveOAuthProvider();
  const del = useDeleteOAuthProvider();
  const [draft, setDraft] = React.useState<Draft>(() => draftOf(conf));
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => setDraft(draftOf(conf)), [conf]);

  const p = conf.provider;
  // GitHub 用 Client ID/Secret 术语；飞书/Lark 用 App ID/Secret。
  const idLabel = p === 'github' ? 'Client ID' : 'App ID';
  const secretLabel = p === 'github' ? 'Client Secret' : 'App Secret';
  const canSave = draft.appId.trim().length > 0 && (conf.source === 'db' || draft.appSecret.trim().length > 0);

  const submit = () => {
    setError(null);
    save.mutate(
      {
        provider: p,
        appId: draft.appId.trim(),
        appSecret: draft.appSecret.trim() || undefined,
        redirectUri: draft.redirectUri.trim() || null,
        enabled: draft.enabled,
      },
      {
        onSuccess: () => {
          setSavedAt(Date.now());
          setTimeout(() => setSavedAt(null), 3000);
        },
        onError: (e) => setError(e.message),
      },
    );
  };

  return (
    <section className="rounded-[14px] border border-border bg-surface px-5 py-4 shadow-1">
      <div className="flex items-center gap-2.5">
        <h2 className="m-0 text-[15px] font-semibold text-fg-1">{PROVIDER_LABEL[p]}</h2>
        <SourceBadge source={conf.source} />
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-[12.5px] text-fg-2">
          <input
            type="checkbox"
            className="accent-[var(--brand-blue)]"
            checked={draft.enabled}
            onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
          />
          {t('oauth.enabled')}
        </label>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={fieldLabel}>{idLabel}</label>
          <input
            className={inputCls}
            value={draft.appId}
            onChange={(e) => setDraft((d) => ({ ...d, appId: e.target.value }))}
            placeholder={idLabel}
            autoComplete="off"
          />
        </div>
        <div>
          <label className={fieldLabel}>{secretLabel}</label>
          <input
            className={inputCls}
            type="password"
            value={draft.appSecret}
            onChange={(e) => setDraft((d) => ({ ...d, appSecret: e.target.value }))}
            placeholder={conf.hasSecret ? t('oauth.secretKeep') : secretLabel}
            autoComplete="new-password"
          />
        </div>
        <div className="sm:col-span-2">
          <label className={fieldLabel}>Redirect URI</label>
          <input
            className={inputCls}
            value={draft.redirectUri}
            onChange={(e) => setDraft((d) => ({ ...d, redirectUri: e.target.value }))}
            placeholder={conf.derivedRedirectPath}
            autoComplete="off"
          />
          <p className="mb-0 mt-1 text-[11.5px] text-fg-3">
            {t('oauth.redirectUriHint', { url: conf.derivedRedirectUri })}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2.5">
        <Button variant="primary" size="sm" onClick={submit} disabled={!canSave || save.isPending}>
          <Save size={13} /> {t('common.save')}
        </Button>
        {conf.source === 'db' && (
          <PopoverConfirm
            trigger={
              <Button variant="ghost" size="sm">
                <Trash2 size={13} /> {t('oauth.resetDb')}
              </Button>
            }
            title={t('oauth.resetDb')}
            body={t('oauth.resetDbBody')}
            busy={del.isPending}
            onConfirm={() => del.mutate(p)}
          />
        )}
        {savedAt && (
          <span className="inline-flex items-center gap-1 text-[12.5px] font-medium" style={{ color: 'var(--success-500)' }}>
            <Check size={13} /> {t('profile.saved')}
          </span>
        )}
        {error && <span className="text-[12.5px] text-danger">{error}</span>}
      </div>
    </section>
  );
}

export function OAuthProvidersPanel() {
  const t = useT();
  const { data, isLoading, isError } = useOAuthProviders();

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PlatformHeader title={t('settingsPage.tab.oauth')} />
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <Skeleton rows={5} />
        ) : isError || !data ? (
          <StateBlock icon="alert" tone="danger" title={t('matrix.loadFailed')} body={t('platform.common.retry')} />
        ) : (
          <div className="flex max-w-[860px] flex-col gap-4">
            <p className="m-0 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed text-fg-2">
              {t('oauth.desc')}
            </p>
            {data.providers.map((conf) => (
              <ProviderCard key={conf.provider} conf={conf} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
