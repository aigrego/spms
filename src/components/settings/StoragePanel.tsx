'use client';

import * as React from 'react';
import { Check, Plug, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Skeleton, StateBlock } from '@/components/StateBlock';
import { PopoverConfirm, fieldLabel, inputCls } from '@/components/platform/common';
import { ViewHeader } from '@/components/common';
import {
  useDeletePlatformStorageConfig,
  usePlatformStorageConfig,
  useSavePlatformStorageConfig,
} from '@/store/platform';
import { platformApi, type PlatformStorageConfigState, type SavePlatformStorageInput } from '@/lib/platformApi';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/* 设置 → 平台存储（平台管理员）：全局默认附件存储，仅 MinIO 后端。
   凭据需管理员权限（root / consoleAdmin）；公司存储不再自助配置，由平台
   管理员在 公司管理 页为每个公司手动开通按前缀隔离的独立账号。
   密钥加密落库、永不回显（留空 = 保留旧值）。enabled 是平台级总开关。 */

interface Draft {
  endpoint: string;
  port: string; // 输入框用字符串,提交时转 number
  useSsl: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
  publicBaseUrl: string;
}

const emptyDraft: Draft = {
  endpoint: '',
  port: '',
  useSsl: true,
  accessKey: '',
  secretKey: '',
  bucket: '',
  publicBaseUrl: '',
};

function draftOf(data: PlatformStorageConfigState | undefined): Draft {
  if (!data?.configured) return emptyDraft;
  return {
    endpoint: data.minio.endpoint ?? '',
    port: data.minio.port != null ? String(data.minio.port) : '',
    useSsl: data.minio.useSsl,
    accessKey: '',
    secretKey: '',
    bucket: data.minio.bucket ?? '',
    publicBaseUrl: data.minio.publicBaseUrl ?? '',
  };
}

export function StoragePanel() {
  const t = useT();
  const { data, isLoading, isError } = usePlatformStorageConfig();
  const save = useSavePlatformStorageConfig();
  const del = useDeletePlatformStorageConfig();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = React.useState(false);

  React.useEffect(() => {
    if (data) setDraft(draftOf(data));
  }, [data]);

  if (isLoading || !draft) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <ViewHeader title={t('settingsPage.tab.platformStorage')} />
        <div className="p-6">
          <Skeleton rows={5} />
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <ViewHeader title={t('settingsPage.tab.platformStorage')} />
        <div className="p-6">
          <StateBlock icon="alert" tone="danger" title={t('matrix.loadFailed')} body={t('platform.common.retry')} />
        </div>
      </div>
    );
  }

  const configured = data.configured;
  const enabled = configured && data.enabled;
  const hasMinioKeys = configured && data.minio.hasAccessKey && data.minio.hasSecretKey;

  const buildInput = (): SavePlatformStorageInput | string => {
    const m = draft;
    if (!m.endpoint.trim() || !m.bucket.trim()) return t('storage.testFailed') + ': endpoint / bucket';
    if (!hasMinioKeys && (!m.accessKey.trim() || !m.secretKey.trim())) {
      return t('storage.testFailed') + ': accessKey / secretKey';
    }
    const port = m.port.trim() ? Number(m.port.trim()) : null;
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return t('storage.testFailed') + ': port';
    return {
      minio: {
        endpoint: m.endpoint.trim(),
        port,
        useSsl: m.useSsl,
        accessKey: m.accessKey.trim() || undefined,
        secretKey: m.secretKey.trim() || undefined,
        bucket: m.bucket.trim(),
        publicBaseUrl: m.publicBaseUrl.trim() || null,
      },
    };
  };

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const submit = () => {
    const input = buildInput();
    if (typeof input === 'string') return flash(false, input);
    save.mutate(input, {
      onSuccess: () => flash(true, t('profile.saved')),
      onError: (e) => flash(false, e.message),
    });
  };

  const test = () => {
    const input = buildInput();
    if (typeof input === 'string') return flash(false, input);
    setTesting(true);
    platformApi
      .testStorageConfig(input)
      .then(() => flash(true, t('storage.testOk')))
      .catch((e) => flash(false, e.message))
      .finally(() => setTesting(false));
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ViewHeader title={t('settingsPage.tab.platformStorage')}>
        <span
          className={cn(
            'rounded-full px-2.5 py-px text-[12px] font-semibold',
            enabled ? 'bg-brand-blue/10 text-brand-blue' : 'bg-surface-2 text-fg-3',
          )}
        >
          {configured ? (enabled ? `${t('storage.enabled')}: MinIO` : t('storage.disabled')) : t('storage.notConfigured')}
        </span>
        <Toggle
          on={enabled}
          disabledTitle={configured ? undefined : t('storage.enableHint')}
          onToggle={configured ? () => save.mutate({ enabled: !enabled }) : undefined}
        />
      </ViewHeader>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex max-w-[860px] flex-col gap-4">
          <p className="m-0 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed text-fg-2">
            {t('storage.platformDesc')}
          </p>

          <section className="rounded-[14px] border border-border bg-surface px-5 py-4 shadow-1">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={fieldLabel}>{t('storage.endpoint')}</label>
                <input
                  className={inputCls}
                  value={draft.endpoint}
                  onChange={(e) => setDraft((d) => d && { ...d, endpoint: e.target.value })}
                  placeholder="s3.innev.cn"
                  autoComplete="off"
                />
                <p className="mb-0 mt-1 text-[11.5px] text-fg-3">{t('storage.endpointHint')}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={fieldLabel}>{t('storage.port')}</label>
                  <input
                    className={inputCls}
                    value={draft.port}
                    onChange={(e) => setDraft((d) => d && { ...d, port: e.target.value })}
                    placeholder={draft.useSsl ? '443' : '9000'}
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className={fieldLabel}>&nbsp;</label>
                  <label className="flex h-9 items-center gap-1.5 text-[12.5px] text-fg-2">
                    <input
                      type="checkbox"
                      className="accent-[var(--brand-blue)]"
                      checked={draft.useSsl}
                      onChange={(e) => setDraft((d) => d && { ...d, useSsl: e.target.checked })}
                    />
                    {t('storage.useSsl')}
                  </label>
                </div>
              </div>
              <div>
                <label className={fieldLabel}>{t('storage.accessKey')}</label>
                <input
                  className={inputCls}
                  value={draft.accessKey}
                  onChange={(e) => setDraft((d) => d && { ...d, accessKey: e.target.value })}
                  placeholder={hasMinioKeys ? t('storage.secretKeep') : 'Access Key'}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className={fieldLabel}>{t('storage.secretKey')}</label>
                <input
                  className={inputCls}
                  type="password"
                  value={draft.secretKey}
                  onChange={(e) => setDraft((d) => d && { ...d, secretKey: e.target.value })}
                  placeholder={hasMinioKeys ? t('storage.secretKeep') : 'Secret Key'}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className={fieldLabel}>{t('storage.bucket')}</label>
                <input
                  className={inputCls}
                  value={draft.bucket}
                  onChange={(e) => setDraft((d) => d && { ...d, bucket: e.target.value })}
                  placeholder="spms"
                  autoComplete="off"
                />
                <p className="mb-0 mt-1 text-[11.5px] text-fg-3">{t('storage.bucketHint')}</p>
              </div>
              <div>
                <label className={fieldLabel}>{t('storage.publicBaseUrl')}</label>
                <input
                  className={inputCls}
                  value={draft.publicBaseUrl}
                  onChange={(e) => setDraft((d) => d && { ...d, publicBaseUrl: e.target.value })}
                  placeholder="https://s3.innev.cn"
                  autoComplete="off"
                />
                <p className="mb-0 mt-1 text-[11.5px] text-fg-3">{t('storage.publicBaseUrlHint')}</p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2.5">
              <Button variant="primary" size="sm" onClick={submit} disabled={save.isPending}>
                <Save size={13} /> {t('common.save')}
              </Button>
              <Button variant="ghost" size="sm" onClick={test} disabled={testing}>
                <Plug size={13} /> {t('storage.test')}
              </Button>
              {configured && (
                <PopoverConfirm
                  trigger={
                    <Button variant="ghost" size="sm">
                      <Trash2 size={13} /> {t('storage.clear')}
                    </Button>
                  }
                  title={t('storage.clear')}
                  body={t('storage.clearBodyPlatform')}
                  busy={del.isPending}
                  onConfirm={() => del.mutate()}
                />
              )}
              {msg && (
                <span
                  className="inline-flex items-center gap-1 text-[12.5px] font-medium"
                  style={{ color: msg.ok ? 'var(--success-500)' : 'var(--danger-500, var(--danger))' }}
                >
                  {msg.ok && <Check size={13} />} {msg.text}
                </span>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
