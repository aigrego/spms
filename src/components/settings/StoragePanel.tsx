'use client';

import * as React from 'react';
import { Check, Plug, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton, StateBlock } from '@/components/StateBlock';
import { PlatformHeader, PopoverConfirm, fieldLabel, inputCls } from '@/components/platform/common';
import { useDeleteStorageConfig, useSaveStorageConfig, useStorageConfig } from '@/store/platform';
import { api, type SaveStorageConfigInput, type StorageConfigState } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/* 设置 → 文件存储（公司管理员）：本公司附件的存储后端（MinIO / Vercel Blob）。
   无配置 = 禁止上传（零平台兜底）；密钥加密落库、永不回显（留空 = 保留旧值）。 */

interface MinioDraft {
  endpoint: string;
  port: string; // 输入框用字符串,提交时转 number
  useSsl: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
  publicBaseUrl: string;
}

interface Draft {
  backend: 'minio' | 'vercel_blob';
  minio: MinioDraft;
  token: string;
}

const emptyMinio: MinioDraft = {
  endpoint: '',
  port: '',
  useSsl: true,
  accessKey: '',
  secretKey: '',
  bucket: '',
  publicBaseUrl: '',
};

function draftOf(data: StorageConfigState | undefined): Draft {
  if (!data?.configured) return { backend: 'minio', minio: emptyMinio, token: '' };
  return {
    backend: data.backend,
    minio:
      data.backend === 'minio' && data.minio
        ? {
            endpoint: data.minio.endpoint ?? '',
            port: data.minio.port != null ? String(data.minio.port) : '',
            useSsl: data.minio.useSsl,
            accessKey: '',
            secretKey: '',
            bucket: data.minio.bucket ?? '',
            publicBaseUrl: data.minio.publicBaseUrl ?? '',
          }
        : emptyMinio,
    token: '',
  };
}

export function StoragePanel() {
  const t = useT();
  const { data, isLoading, isError } = useStorageConfig();
  const save = useSaveStorageConfig();
  const del = useDeleteStorageConfig();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = React.useState(false);

  React.useEffect(() => {
    if (data) setDraft(draftOf(data));
  }, [data]);

  if (isLoading || !draft) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <PlatformHeader title={t('settingsPage.tab.storage')} />
        <div className="p-6">
          <Skeleton rows={5} />
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <PlatformHeader title={t('settingsPage.tab.storage')} />
        <div className="p-6">
          <StateBlock icon="alert" tone="danger" title={t('matrix.loadFailed')} body={t('platform.common.retry')} />
        </div>
      </div>
    );
  }

  const configured = data.configured;
  const hasMinioKeys = configured && data.backend === 'minio' && !!data.minio?.hasAccessKey && !!data.minio?.hasSecretKey;
  const hasToken = configured && data.backend === 'vercel_blob' && data.hasToken;

  const buildInput = (): SaveStorageConfigInput | string => {
    if (draft.backend === 'minio') {
      const m = draft.minio;
      if (!m.endpoint.trim() || !m.bucket.trim()) return t('storage.testFailed') + ': endpoint / bucket';
      if (!hasMinioKeys && (!m.accessKey.trim() || !m.secretKey.trim())) {
        return t('storage.testFailed') + ': accessKey / secretKey';
      }
      const port = m.port.trim() ? Number(m.port.trim()) : null;
      if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return t('storage.testFailed') + ': port';
      return {
        backend: 'minio',
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
    }
    if (!hasToken && !draft.token.trim()) return t('storage.testFailed') + ': token';
    return { backend: 'vercel_blob', token: draft.token.trim() || undefined };
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
    api
      .testStorageConfig(input)
      .then(() => flash(true, t('storage.testOk')))
      .catch((e) => flash(false, e.message))
      .finally(() => setTesting(false));
  };

  const backendBtn = (key: Draft['backend'], label: string) => (
    <button
      type="button"
      onClick={() => setDraft((d) => d && { ...d, backend: key })}
      className={cn(
        'rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors',
        draft.backend === key
          ? 'border-brand-blue bg-brand-blue/10 text-brand-blue'
          : 'border-border-strong bg-surface text-fg-2 hover:bg-surface-2',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PlatformHeader title={t('settingsPage.tab.storage')}>
        <span
          className={cn(
            'rounded-full px-2.5 py-px text-[12px] font-semibold',
            configured ? 'bg-brand-blue/10 text-brand-blue' : 'bg-surface-2 text-fg-3',
          )}
        >
          {configured
            ? `${t('storage.configuredAs')}: ${data.backend === 'minio' ? 'MinIO' : 'Vercel Blob'}`
            : t('storage.notConfigured')}
        </span>
      </PlatformHeader>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex max-w-[860px] flex-col gap-4">
          <p className="m-0 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed text-fg-2">
            {t('storage.desc')}
          </p>

          <section className="rounded-[14px] border border-border bg-surface px-5 py-4 shadow-1">
            <label className={fieldLabel}>{t('storage.backend')}</label>
            <div className="flex gap-2">
              {backendBtn('minio', t('storage.minio'))}
              {backendBtn('vercel_blob', t('storage.vercelBlob'))}
            </div>

            {draft.backend === 'minio' ? (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={fieldLabel}>{t('storage.endpoint')}</label>
                  <input
                    className={inputCls}
                    value={draft.minio.endpoint}
                    onChange={(e) => setDraft((d) => d && { ...d, minio: { ...d.minio, endpoint: e.target.value } })}
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
                      value={draft.minio.port}
                      onChange={(e) => setDraft((d) => d && { ...d, minio: { ...d.minio, port: e.target.value } })}
                      placeholder={draft.minio.useSsl ? '443' : '9000'}
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
                        checked={draft.minio.useSsl}
                        onChange={(e) => setDraft((d) => d && { ...d, minio: { ...d.minio, useSsl: e.target.checked } })}
                      />
                      {t('storage.useSsl')}
                    </label>
                  </div>
                </div>
                <div>
                  <label className={fieldLabel}>{t('storage.accessKey')}</label>
                  <input
                    className={inputCls}
                    value={draft.minio.accessKey}
                    onChange={(e) => setDraft((d) => d && { ...d, minio: { ...d.minio, accessKey: e.target.value } })}
                    placeholder={hasMinioKeys ? t('storage.secretKeep') : 'Access Key'}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className={fieldLabel}>{t('storage.secretKey')}</label>
                  <input
                    className={inputCls}
                    type="password"
                    value={draft.minio.secretKey}
                    onChange={(e) => setDraft((d) => d && { ...d, minio: { ...d.minio, secretKey: e.target.value } })}
                    placeholder={hasMinioKeys ? t('storage.secretKeep') : 'Secret Key'}
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label className={fieldLabel}>{t('storage.bucket')}</label>
                  <input
                    className={inputCls}
                    value={draft.minio.bucket}
                    onChange={(e) => setDraft((d) => d && { ...d, minio: { ...d.minio, bucket: e.target.value } })}
                    placeholder="spms"
                    autoComplete="off"
                  />
                  <p className="mb-0 mt-1 text-[11.5px] text-fg-3">{t('storage.bucketHint')}</p>
                </div>
                <div>
                  <label className={fieldLabel}>{t('storage.publicBaseUrl')}</label>
                  <input
                    className={inputCls}
                    value={draft.minio.publicBaseUrl}
                    onChange={(e) => setDraft((d) => d && { ...d, minio: { ...d.minio, publicBaseUrl: e.target.value } })}
                    placeholder="https://s3.innev.cn"
                    autoComplete="off"
                  />
                  <p className="mb-0 mt-1 text-[11.5px] text-fg-3">{t('storage.publicBaseUrlHint')}</p>
                </div>
              </div>
            ) : (
              <div className="mt-4">
                <label className={fieldLabel}>{t('storage.token')}</label>
                <input
                  className={inputCls}
                  type="password"
                  value={draft.token}
                  onChange={(e) => setDraft((d) => d && { ...d, token: e.target.value })}
                  placeholder={hasToken ? t('storage.secretKeep') : 'vercel_blob_rw_…'}
                  autoComplete="new-password"
                />
              </div>
            )}

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
                  body={t('storage.clearBody')}
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
