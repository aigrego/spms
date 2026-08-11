'use client';

import * as React from 'react';
import { Plus, BookOpen, Copy, Check, UserCog, Ban, Trash2, FolderKanban } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TabBtn } from '@/components/ui/segmented';
import { Skeleton, StateBlock } from '@/components/StateBlock';
import { useMcpKeys, useRevokeMcpKey, useDeleteMcpKey, useUpdateMcpKey } from '@/store/platform';
import { CreateKeyModal, KeyRevealDialog, useOwnerCandidates } from '@/components/platform/CreateKeyModal';
import { PopoverConfirm, fmtDate, tdCls, thCls, fieldLabel, inputCls } from '@/components/platform/common';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ApiError } from '@/lib/api';
import { ProjectCheckList } from '@/components/ProjectCheckList';
import { useAppData } from '@/store/AppData';
import { useT } from '@/lib/i18n';
import { relativeTime } from '@/lib/time';
import type { McpKey } from '@/lib/platformApi';

const CAP_TONE: Record<string, 'blue' | 'orange' | 'danger'> = {
  read: 'blue',
  write: 'orange',
  delete: 'danger',
};

function statusOf(k: McpKey): { key: 'revoked' | 'expired' | 'active'; tone: 'success' | 'warning' | 'neutral' } {
  if (k.revokedAt) return { key: 'revoked', tone: 'neutral' };
  if (k.expiresAt && new Date(k.expiresAt).getTime() <= Date.now()) return { key: 'expired', tone: 'warning' };
  return { key: 'active', tone: 'success' };
}

function CodeBox({ text, children }: { text: string; children: React.ReactNode }) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable (non-secure context) — the text is selectable anyway
    }
  };
  return (
    <div className="group relative overflow-x-auto rounded-lg border border-border bg-surface-2 px-3 py-2.5 font-mono text-[12.5px] whitespace-pre text-fg-1">
      {children}
      <button
        type="button"
        onClick={copy}
        title={t('keys.copy')}
        aria-label={t('keys.copy')}
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md border border-border bg-surface text-fg-3 opacity-0 shadow-1 transition-opacity hover:text-fg-1 group-hover:opacity-100"
      >
        {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

/* Agent 接入(API Keys):令牌列表(我的 / 全租户)+ 接入指引。
   布局参照统一设计:能力徽标、有效期、最近使用、状态列 + 吊销操作。
   member 自助视图:只有"我的令牌",新建自动归属当前公司;全租户子 Tab
   与平台级 scope 仅平台管理员可见。 */
export function KeysPanel() {
  const t = useT();
  const { data: keys, isLoading, isError } = useMcpKeys();
  const revoke = useRevokeMcpKey();
  const remove = useDeleteMcpKey();
  const { session, isPlatformAdmin, projectById, projects, currentCompany } = useAppData();
  const [tab, setTab] = React.useState<'mine' | 'all'>('mine');
  const [modalOpen, setModalOpen] = React.useState(false);
  const [issued, setIssued] = React.useState<{ id: string; key: string; prefix: string } | null>(null);
  const [editing, setEditing] = React.useState<McpKey | null>(null);
  const [editingProjects, setEditingProjects] = React.useState<McpKey | null>(null);

  const myId = session?.user.id ?? null;
  const mine = (keys ?? []).filter((k) => k.createdBy === myId);
  const shown = isPlatformAdmin && tab === 'all' ? (keys ?? []) : mine;

  const endpoint = typeof window !== 'undefined' ? `${window.location.origin}/mcp` : '/mcp';
  const claudeCmd = `claude mcp add --transport http ai-grego-track ${endpoint} --header "Authorization: Bearer spms_…"`;
  const cursorConfig = `{
  "mcpServers": {
    "ai-grego-track": {
      "url": "${endpoint}",
      "headers": { "Authorization": "Bearer spms_…" }
    }
  }
}`;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Header:标题 + 计数 + 描述 + 新建 */}
      <div className="flex flex-none items-start gap-4 px-6 pb-4 pt-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-bold text-fg-1">{t('nav.agentAccess')}</h1>
            {keys != null && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-semibold text-fg-3">
                {keys.length}
              </span>
            )}
          </div>
          <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-fg-3">
            {t('keys.subtitle')}
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => setModalOpen(true)} className="flex-none">
          <Plus size={14} /> {t('keys.new')}
        </Button>
      </div>

      {/* 子 Tab:我的令牌 / 全租户令牌(全租户仅平台管理员) */}
      {isPlatformAdmin && (
        <div className="flex flex-none items-center gap-4 border-b border-border px-6">
          <TabBtn active={tab === 'mine'} onClick={() => setTab('mine')}>
            {t('keys.tabMine')}
          </TabBtn>
          <TabBtn active={tab === 'all'} onClick={() => setTab('all')}>
            {t('keys.tabAll')}
          </TabBtn>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <Skeleton rows={5} />
        ) : isError ? (
          <StateBlock icon="alert" tone="danger" title={t('keys.loadFailed')} body={t('platform.common.retry')} />
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-bg">
              <tr className="border-b border-border">
                <th className={thCls}>{t('form.name')}</th>
                <th className={`${thCls} whitespace-nowrap`}>{t('keys.colOwner')}</th>
                <th className={`${thCls} whitespace-nowrap`}>{t('keys.colCaps')}</th>
                <th className={`${thCls} whitespace-nowrap`}>{t('keys.scope')}</th>
                <th className={`${thCls} whitespace-nowrap`}>{t('group.project')}</th>
                <th className={`${thCls} whitespace-nowrap`}>{t('keys.colExpires')}</th>
                <th className={`${thCls} whitespace-nowrap`}>{t('keys.colLastUsed')}</th>
                <th className={`${thCls} whitespace-nowrap`}>{t('menu.status')}</th>
                <th className={`${thCls} whitespace-nowrap text-right`} />
              </tr>
            </thead>
            <tbody>
              {!shown.length && (
                <tr className="border-b border-border">
                  <td colSpan={9} className="px-4 py-10 text-center text-[13px] text-fg-3">
                    {tab === 'mine' ? t('keys.emptyMine') : t('keys.emptyAll')}
                  </td>
                </tr>
              )}
              {shown.map((k) => {
                const st = statusOf(k);
                const caps = k.capabilities.split(',').map((c) => c.trim()).filter(Boolean);
                return (
                  <tr key={k.id} className="border-b border-border hover:bg-surface-2/60">
                    <td className={tdCls}>
                      <div className="max-w-[360px] truncate font-medium" title={k.name}>
                        {k.name}
                      </div>
                      <code className="font-mono text-[12px] text-fg-3">{k.prefix}…</code>
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}>
                      <span className="text-fg-2">{k.ownerName ?? '—'}</span>
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}>
                      <span className="inline-flex gap-1.5">
                        {caps.map((c) => (
                          <Badge key={c} tone={CAP_TONE[c] ?? 'neutral'}>
                            {t(`keys.cap.${c}`)}
                          </Badge>
                        ))}
                      </span>
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}>{k.companyId ? (k.companyName ?? '—') : t('keys.scopeAll')}</td>
                    <td className={`${tdCls} whitespace-nowrap`}>
                      {k.projectIds ? (
                        <span
                          className="text-fg-2"
                          title={k.projectIds.map((id) => projectById(id)?.name ?? id).join('、')}
                        >
                          {t('keys.nProjects', { n: k.projectIds.length })}
                        </span>
                      ) : (
                        <span className="text-fg-2">{t('keys.allProjects')}</span>
                      )}
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}>
                      <span className="text-fg-2">{k.expiresAt ? fmtDate(k.expiresAt) : t('keys.forever')}</span>
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}>
                      <span className="text-fg-3">{k.lastUsedAt ? relativeTime(k.lastUsedAt, t) : '—'}</span>
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}>
                      <Badge tone={st.tone} dot>
                        {t(`keys.status.${st.key}`)}
                      </Badge>
                    </td>
                    <td className={`${tdCls} whitespace-nowrap text-right`}>
                      <span className="inline-flex items-center gap-1">
                        {/* 项目白名单只能在 key 归属当前公司时编辑（项目列表来自当前公司 bootstrap） */}
                        {k.companyId === currentCompany?.id && projects.length > 0 && (
                          <button
                            title={t('keys.editWhitelist')}
                            aria-label={t('keys.editWhitelist')}
                            className="grid h-7 w-7 place-items-center rounded-md text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg-1"
                            onClick={() => setEditingProjects(k)}
                          >
                            <FolderKanban size={14} />
                          </button>
                        )}
                        <button
                          title={t('keys.changeOwner')}
                          aria-label={t('keys.changeOwner')}
                          className="grid h-7 w-7 place-items-center rounded-md text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg-1"
                          onClick={() => setEditing(k)}
                        >
                          <UserCog size={14} />
                        </button>
                        {!k.revokedAt && (
                          <PopoverConfirm
                            title={t('keys.revokeTitle', { name: k.name })}
                            body={t('keys.revokeBody')}
                            confirmLabel={t('keys.revoke')}
                            busy={revoke.isPending}
                            onConfirm={() => revoke.mutate(k.id)}
                            trigger={
                              <button
                                title={t('keys.revoke')}
                                aria-label={t('keys.revoke')}
                                className="grid h-7 w-7 place-items-center rounded-md text-fg-3 transition-colors hover:bg-danger-50 hover:text-danger"
                              >
                                <Ban size={14} />
                              </button>
                            }
                          />
                        )}
                        <PopoverConfirm
                          title={t('keys.deleteTitle', { name: k.name })}
                          body={t('keys.deleteBody')}
                          confirmLabel={t('keys.delete')}
                          busy={remove.isPending}
                          onConfirm={() => remove.mutate(k.id)}
                          trigger={
                            <button
                              title={t('keys.delete')}
                              aria-label={t('keys.delete')}
                              className="grid h-7 w-7 place-items-center rounded-md text-fg-3 transition-colors hover:bg-danger-50 hover:text-danger"
                            >
                              <Trash2 size={14} />
                            </button>
                          }
                        />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* 接入指引 */}
        <div className="mx-6 my-5 max-w-[860px] rounded-[14px] border border-border bg-surface px-5 py-4 shadow-1">
          <div className="mb-3 flex items-center gap-2">
            <BookOpen size={15} className="text-fg-3" />
            <h2 className="text-[14.5px] font-semibold text-fg-1">{t('keys.guide')}</h2>
          </div>
          <div className="flex flex-col gap-3.5">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">{t('keys.endpoint')}</div>
              <CodeBox text={endpoint}>{endpoint}</CodeBox>
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">Claude Code</div>
              <CodeBox text={claudeCmd}>{claudeCmd}</CodeBox>
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
                Cursor (.cursor/mcp.json)
              </div>
              <CodeBox text={cursorConfig}>{cursorConfig}</CodeBox>
            </div>
            <p className="text-[12.5px] leading-relaxed text-fg-3">
              {t('keys.guideNote')}
            </p>
          </div>
        </div>
      </div>

      <CreateKeyModal open={modalOpen} onOpenChange={setModalOpen} onIssued={setIssued} platformAdmin={isPlatformAdmin} />
      <KeyRevealDialog issued={issued} onClose={() => setIssued(null)} />
      {editing && <EditOwnerModal k={editing} platformAdmin={isPlatformAdmin} onClose={() => setEditing(null)} />}
      {editingProjects && <EditProjectsModal k={editingProjects} onClose={() => setEditingProjects(null)} />}
    </div>
  );
}

/* 编辑令牌的项目白名单：全部选中保存为 null（不限制，与存量令牌一致），
   至少选一个。项目列表来自当前公司 bootstrap。 */
function EditProjectsModal({ k, onClose }: { k: McpKey; onClose: () => void }) {
  const t = useT();
  const { projects } = useAppData();
  const update = useUpdateMcpKey();
  const [sel, setSel] = React.useState<string[]>(
    // 已删除的项目 id 不出现在列表里，过滤掉避免带着幽灵 id 提交
    k.projectIds?.filter((id) => projects.some((p) => p.id === id)) ?? projects.map((p) => p.id),
  );
  const [error, setError] = React.useState<string | null>(null);

  const toggle = (id: string) =>
    setSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const submit = async () => {
    setError(null);
    try {
      await update.mutateAsync({
        id: k.id,
        projectIds: sel.length === projects.length ? null : sel,
      });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('platform.common.saveFailed'));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[min(420px,92vw)]">
        <DialogPrimitive.Title className="px-[18px] pb-1 pt-4 text-[15px] font-semibold text-fg-1">
          {t('keys.whitelistTitle', { name: k.name })}
        </DialogPrimitive.Title>
        <div className="flex flex-col gap-3 px-[18px] py-3">
          <div className="text-[12px] text-fg-3">{t('keys.whitelistHint')}</div>
          <ProjectCheckList projects={projects} selected={sel} onToggle={toggle} maxH="max-h-64" />
          {error && <div className="rounded-lg bg-danger-50 px-3 py-2 text-[12.5px] text-danger">{error}</div>}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="md" onClick={submit} disabled={sel.length === 0 || update.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* 修改令牌所属人:候选与新建时一致(公司级 key → 该公司成员;平台级 → 全部
   用户;普通成员 → bootstrap 的 human 成员)。 */
function EditOwnerModal({
  k,
  platformAdmin,
  onClose,
}: {
  k: McpKey;
  platformAdmin: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const update = useUpdateMcpKey();
  const [ownerId, setOwnerId] = React.useState(k.ownerId ?? '');
  const [error, setError] = React.useState<string | null>(null);
  const options = useOwnerCandidates(platformAdmin, k.companyId);

  const submit = async () => {
    setError(null);
    try {
      await update.mutateAsync({ id: k.id, ownerId });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('platform.common.saveFailed'));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[min(420px,92vw)]">
        <DialogPrimitive.Title className="px-[18px] pb-1 pt-4 text-[15px] font-semibold text-fg-1">
          {t('keys.ownerTitle', { name: k.name })}
        </DialogPrimitive.Title>
        <div className="flex flex-col gap-3 px-[18px] py-3">
          <div>
            <span className={fieldLabel}>{t('keys.ownerLabel')}</span>
            <select className={inputCls} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              {!options.some((o) => o.id === ownerId) && (
                <option value={ownerId}>{k.ownerName ?? t('keys.currentOwner')}</option>
              )}
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          {error && <div className="rounded-lg bg-danger-50 px-3 py-2 text-[12.5px] text-danger">{error}</div>}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!ownerId || update.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
