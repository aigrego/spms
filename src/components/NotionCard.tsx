'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, type NotionConnectionInfo, type NotionSyncResult } from '@/lib/api';
import { SPMS_STATUSES, type NotionStatusRule } from '@/lib/notionStatusMap';
import { useAppData } from '@/store/AppData';
import { useT } from '@/lib/i18n';

const selectCls =
  'h-8 rounded-md border border-border-strong bg-surface px-2 text-[13px] text-fg-1 outline-none focus:border-brand-blue disabled:opacity-60';
const primaryBtnCls =
  'h-8 rounded-md bg-brand-blue px-3 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40';
const secondaryBtnCls =
  'h-8 rounded-md border border-border-strong bg-surface px-3 text-[13px] font-medium text-fg-1 disabled:cursor-not-allowed disabled:opacity-40';

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

/* 「Notion 集成」卡片(连接 / 配置数据库与目标项目 / 预览 / 同步 / 断开)。
   OAuth 回调跳回 /integrations?notion=connected|failed,这里给出内联反馈。
   无 issues 写权限(FORBIDDEN)时整张卡片隐藏。 */
export function NotionCard() {
  const t = useT();
  const sp = useSearchParams();
  const qc = useQueryClient();

  const { data, error } = useQuery({
    queryKey: ['notion-integration'],
    queryFn: () => api.notionIntegration(),
  });
  const conn = data?.connection ?? null;

  // OAuth 回调反馈;同时刷新连接状态。
  const notionResult = sp.get('notion');
  React.useEffect(() => {
    if (notionResult) qc.invalidateQueries({ queryKey: ['notion-integration'] });
  }, [notionResult, qc]);

  if (error instanceof ApiError && error.code === 'FORBIDDEN') return null;

  return (
    <Card title={t('settingsPage.notion')}>
      {notionResult === 'connected' && (
        <div
          className="mb-3 rounded-lg px-3 py-2 text-[12.5px]"
          style={{ background: 'var(--success-50, #E8F7EE)', color: '#17723B' }}
        >
          {t('settingsPage.notionConnectedOk')}
        </div>
      )}
      {notionResult === 'failed' && (
        <div
          className="mb-3 rounded-lg px-3 py-2 text-[12.5px]"
          style={{ background: 'var(--danger-50, #FDECEA)', color: '#C0392B' }}
        >
          {t('settingsPage.notionConnectFailed')}
        </div>
      )}

      {error ? (
        <div className="py-3 text-[13px] text-fg-3">{t('settingsPage.notionLoadFailed')}</div>
      ) : !conn ? (
        <Row
          label={t('settingsPage.notionConnect')}
          desc={data && !data.configured ? t('settingsPage.notionNotConfigured') : t('settingsPage.notionDesc')}
          control={
            <button
              type="button"
              className={primaryBtnCls}
              disabled={!data?.configured}
              title={data && !data.configured ? t('settingsPage.notionNotConfigured') : undefined}
              onClick={() => {
                window.location.href = '/api/v1/pms/integrations/notion/authorize';
              }}
            >
              {t('settingsPage.notionConnect')}
            </button>
          }
        />
      ) : (
        // key 随已保存的数据库/项目变化:保存成功后表单按最新连接状态重置。
        <NotionConnectionForm
          key={`${conn.databaseId ?? ''}:${conn.projectId ?? ''}`}
          conn={conn}
        />
      )}
    </Card>
  );
}

/* 已连接状态的配置表单:工作区 + 数据库/项目选择 + 保存/预览/同步/断开。 */
function NotionConnectionForm({ conn }: { conn: NotionConnectionInfo }) {
  const t = useT();
  const { projects } = useAppData();
  const qc = useQueryClient();

  const { data: dbData } = useQuery({
    queryKey: ['notion-databases'],
    queryFn: () => api.notionIntegration({ databases: true }),
  });

  // 状态映射/过滤规则:随已保存的数据库加载,与数据库/项目一起点「保存」提交。
  const { data: statusData } = useQuery({
    queryKey: ['notion-statuses', conn.databaseId],
    queryFn: () => api.notionIntegration({ statuses: true }),
    enabled: !!conn.databaseId,
  });
  // 用户编辑以查询结果为基底保存在本地;查询刷新(新数组标识)后自动回退为最新拉取值。
  const [edits, setEdits] = React.useState<{ base: NotionStatusRule[]; rules: NotionStatusRule[] } | null>(null);
  const rules = edits && edits.base === statusData?.statuses ? edits.rules : (statusData?.statuses ?? null);
  const setRules = (next: NotionStatusRule[]) => {
    if (statusData?.statuses) setEdits({ base: statusData.statuses, rules: next });
  };

  const [databaseId, setDatabaseId] = React.useState(conn.databaseId ?? '');
  const [projectId, setProjectId] = React.useState(conn.projectId ?? '');
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [previewJson, setPreviewJson] = React.useState<string | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const [syncResult, setSyncResult] = React.useState<NotionSyncResult | null>(null);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    setSaved(false);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const dbOpt = dbData?.databases?.find((d) => d.id === databaseId);
      await api.updateNotionIntegration({
        databaseId: databaseId || null,
        databaseName: databaseId ? (dbOpt?.name ?? conn.databaseName ?? null) : null,
        projectId: projectId || null,
        ...(rules ? { statusMap: rules } : {}),
      });
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ['notion-integration'] });
      await qc.invalidateQueries({ queryKey: ['notion-statuses'] });
    });

  const doPreview = () =>
    run(async () => {
      const { page } = await api.notionPreview();
      setPreviewJson(JSON.stringify(page, null, 2));
    });

  const doSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setActionError(null);
    try {
      const result = await api.syncNotion();
      setSyncResult(result);
      await qc.invalidateQueries({ queryKey: ['notion-integration'] });
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = () =>
    run(async () => {
      await api.disconnectNotion();
      await qc.invalidateQueries({ queryKey: ['notion-integration'] });
      await qc.invalidateQueries({ queryKey: ['notion-databases'] });
    });

  const databases = dbData?.databases ?? null;
  const dbKnown = databases?.some((d) => d.id === databaseId);
  const syncReady = !!(conn.databaseId && conn.projectId);

  return (
    <>
      {actionError && (
        <div
          className="mb-3 rounded-lg px-3 py-2 text-[12.5px]"
          style={{ background: 'var(--danger-50, #FDECEA)', color: '#C0392B' }}
        >
          {actionError}
        </div>
      )}
      <Row
        label={t('settingsPage.notionWorkspace')}
        desc={conn.lastSyncedAt ? t('settingsPage.notionLastSynced', { time: new Date(conn.lastSyncedAt).toLocaleString() }) : undefined}
        control={
          <span className="flex items-center gap-2">
            <span className="text-[13px] text-fg-1">{conn.workspaceName ?? conn.workspaceId ?? '—'}</span>
            <button
              type="button"
              className={secondaryBtnCls}
              style={{ color: '#C0392B' }}
              disabled={busy || syncing}
              onClick={disconnect}
            >
              {t('settingsPage.notionDisconnect')}
            </button>
          </span>
        }
      />
      <Row
        label={t('settingsPage.notionDatabase')}
        desc={dbData?.databasesError ? t('settingsPage.notionDatabasesFailed') : undefined}
        control={
          <select
            className={selectCls}
            value={databaseId}
            disabled={busy || !databases}
            onChange={(e) => setDatabaseId(e.target.value)}
          >
            <option value="">{t('settingsPage.notionDatabaseEmpty')}</option>
            {databaseId && !dbKnown && <option value={databaseId}>{conn.databaseName ?? databaseId}</option>}
            {databases?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        }
      />
      <Row
        label={t('settingsPage.notionProject')}
        control={
          <select
            className={selectCls}
            value={projectId}
            disabled={busy}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">{t('settingsPage.notionProjectEmpty')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        }
      />
      {conn.databaseId && (
        <div className="border-b border-border py-3">
          <div className="mb-2">
            <div className="text-[13.5px] font-medium text-fg-1">{t('settingsPage.notionStatusMap')}</div>
            <div className="mt-0.5 text-[12px] text-fg-3">{t('settingsPage.notionStatusMapDesc')}</div>
          </div>
          {statusData?.statusesError ? (
            <div className="text-[12.5px] text-fg-3">{t('settingsPage.notionStatusesFailed')}</div>
          ) : !rules ? (
            <div className="text-[12.5px] text-fg-3">{t('settingsPage.notionPreviewing')}</div>
          ) : (
            <div className="space-y-1.5">
              {rules.map((r, i) => (
                <div key={r.name} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-brand-blue"
                    checked={r.sync}
                    disabled={busy}
                    onChange={(e) =>
                      setRules(rules.map((x, j) => (j === i ? { ...x, sync: e.target.checked } : x)))
                    }
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-fg-1" title={r.name}>
                    {r.name}
                  </span>
                  <select
                    className={selectCls}
                    value={r.status ?? ''}
                    disabled={busy || !r.sync}
                    onChange={(e) =>
                      setRules(
                        rules.map((x, j) =>
                          j === i ? { ...x, status: (e.target.value || null) as NotionStatusRule['status'] } : x,
                        ),
                      )
                    }
                  >
                    <option value="">{t('settingsPage.notionStatusNone')}</option>
                    {SPMS_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(`status.${s}`)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <Row
        label={t('settingsPage.notionSave')}
        control={
          <span className="flex items-center gap-2">
            {saved && (
              <span className="text-[12.5px]" style={{ color: '#17723B' }}>
                {t('settingsPage.notionSaved')}
              </span>
            )}
            <button type="button" className={secondaryBtnCls} disabled={busy || syncing} onClick={doPreview}>
              {busy ? t('settingsPage.notionPreviewing') : t('settingsPage.notionPreview')}
            </button>
            <button type="button" className={primaryBtnCls} disabled={busy || syncing} onClick={save}>
              {t('settingsPage.notionSave')}
            </button>
          </span>
        }
      />
      <Row
        label={t('settingsPage.notionSync')}
        desc={syncReady ? undefined : t('settingsPage.notionSyncNeedConfig')}
        control={
          <button
            type="button"
            className={primaryBtnCls}
            disabled={busy || syncing || !syncReady}
            title={syncReady ? undefined : t('settingsPage.notionSyncNeedConfig')}
            onClick={doSync}
          >
            {syncing ? t('settingsPage.notionSyncing') : t('settingsPage.notionSync')}
          </button>
        }
      />
      {syncResult && (
        <div className="mt-2">
          <div className="text-[12.5px] text-fg-2">
            {t('settingsPage.notionSyncResult', {
              created: syncResult.created,
              updated: syncResult.updated,
              skipped: syncResult.skipped,
              failed: syncResult.errors.length,
            })}
          </div>
          {syncResult.errors.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[12.5px]" style={{ color: '#C0392B' }}>
                {t('settingsPage.notionSyncErrors')}({syncResult.errors.length})
              </summary>
              <pre className="mt-2 max-h-[240px] overflow-auto rounded-lg bg-surface-sunken p-3 text-[11.5px] leading-relaxed text-fg-2">
                {syncResult.errors.join('\n')}
              </pre>
            </details>
          )}
        </div>
      )}
      {previewJson && (
        <details open className="mt-2">
          <summary className="cursor-pointer text-[12.5px] text-fg-3">
            {t('settingsPage.notionPreview')}
          </summary>
          <pre className="mt-2 max-h-[360px] overflow-auto rounded-lg bg-surface-sunken p-3 text-[11.5px] leading-relaxed text-fg-2">
            {previewJson}
          </pre>
        </details>
      )}
    </>
  );
}
