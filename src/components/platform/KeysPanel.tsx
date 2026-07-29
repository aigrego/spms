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

const CAP_LABEL: Record<string, string> = { read: '读取', write: '写入', delete: '删除' };
const CAP_TONE: Record<string, 'blue' | 'orange' | 'danger'> = {
  read: 'blue',
  write: 'orange',
  delete: 'danger',
};

function statusOf(k: McpKey): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  if (k.revokedAt) return { label: '已吊销', tone: 'neutral' };
  if (k.expiresAt && new Date(k.expiresAt).getTime() <= Date.now()) return { label: '已过期', tone: 'warning' };
  return { label: '有效', tone: 'success' };
}

function CodeBox({ text, children }: { text: string; children: React.ReactNode }) {
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
        title="复制"
        aria-label="复制"
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
            <h1 className="text-[20px] font-bold text-fg-1">Agent 接入</h1>
            {keys != null && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-semibold text-fg-3">
                {keys.length}
              </span>
            )}
          </div>
          <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-fg-3">
            让 Claude Code / Cursor 等编码 Agent 经 MCP 协议接入,在授权公司内读写需求、Issue 与测试用例,并完成修复闭环。
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => setModalOpen(true)} className="flex-none">
          <Plus size={14} /> 新建令牌
        </Button>
      </div>

      {/* 子 Tab:我的令牌 / 全租户令牌(全租户仅平台管理员) */}
      {isPlatformAdmin && (
        <div className="flex flex-none items-center gap-4 border-b border-border px-6">
          <TabBtn active={tab === 'mine'} onClick={() => setTab('mine')}>
            我的令牌
          </TabBtn>
          <TabBtn active={tab === 'all'} onClick={() => setTab('all')}>
            全租户令牌
          </TabBtn>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <Skeleton rows={5} />
        ) : isError ? (
          <StateBlock icon="alert" tone="danger" title="令牌列表加载失败" body="请稍后重试。" />
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-bg">
              <tr className="border-b border-border">
                <th className={thCls}>名称</th>
                <th className={`${thCls} whitespace-nowrap`}>所属人</th>
                <th className={`${thCls} whitespace-nowrap`}>能力</th>
                <th className={`${thCls} whitespace-nowrap`}>范围</th>
                <th className={`${thCls} whitespace-nowrap`}>项目</th>
                <th className={`${thCls} whitespace-nowrap`}>有效期至</th>
                <th className={`${thCls} whitespace-nowrap`}>最近使用</th>
                <th className={`${thCls} whitespace-nowrap`}>状态</th>
                <th className={`${thCls} whitespace-nowrap text-right`} />
              </tr>
            </thead>
            <tbody>
              {!shown.length && (
                <tr className="border-b border-border">
                  <td colSpan={9} className="px-4 py-10 text-center text-[13px] text-fg-3">
                    {tab === 'mine' ? '你还没有令牌' : '还没有任何令牌'}
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
                            {CAP_LABEL[c] ?? c}
                          </Badge>
                        ))}
                      </span>
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}>{k.companyId ? (k.companyName ?? '—') : '全平台'}</td>
                    <td className={`${tdCls} whitespace-nowrap`}>
                      {k.projectIds ? (
                        <span
                          className="text-fg-2"
                          title={k.projectIds.map((id) => projectById(id)?.name ?? id).join('、')}
                        >
                          {k.projectIds.length} 个项目
                        </span>
                      ) : (
                        <span className="text-fg-2">全部项目</span>
                      )}
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}>
                      <span className="text-fg-2">{k.expiresAt ? fmtDate(k.expiresAt) : '永久'}</span>
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}>
                      <span className="text-fg-3">{k.lastUsedAt ? relativeTime(k.lastUsedAt, t) : '—'}</span>
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}>
                      <Badge tone={st.tone} dot>
                        {st.label}
                      </Badge>
                    </td>
                    <td className={`${tdCls} whitespace-nowrap text-right`}>
                      <span className="inline-flex items-center gap-1">
                        {/* 项目白名单只能在 key 归属当前公司时编辑（项目列表来自当前公司 bootstrap） */}
                        {k.companyId === currentCompany?.id && projects.length > 0 && (
                          <button
                            title="编辑项目白名单"
                            aria-label="编辑项目白名单"
                            className="grid h-7 w-7 place-items-center rounded-md text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg-1"
                            onClick={() => setEditingProjects(k)}
                          >
                            <FolderKanban size={14} />
                          </button>
                        )}
                        <button
                          title="改所属人"
                          aria-label="改所属人"
                          className="grid h-7 w-7 place-items-center rounded-md text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg-1"
                          onClick={() => setEditing(k)}
                        >
                          <UserCog size={14} />
                        </button>
                        {!k.revokedAt && (
                          <PopoverConfirm
                            title={`吊销「${k.name}」?`}
                            body="吊销后使用该令牌的调用将立即失效。"
                            confirmLabel="吊销"
                            busy={revoke.isPending}
                            onConfirm={() => revoke.mutate(k.id)}
                            trigger={
                              <button
                                title="吊销"
                                aria-label="吊销"
                                className="grid h-7 w-7 place-items-center rounded-md text-fg-3 transition-colors hover:bg-danger-50 hover:text-danger"
                              >
                                <Ban size={14} />
                              </button>
                            }
                          />
                        )}
                        <PopoverConfirm
                          title={`删除「${k.name}」?`}
                          body="删除后该令牌立即失效且不可恢复,列表中也不再保留记录。"
                          confirmLabel="删除"
                          busy={remove.isPending}
                          onConfirm={() => remove.mutate(k.id)}
                          trigger={
                            <button
                              title="删除"
                              aria-label="删除"
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
            <h2 className="text-[14.5px] font-semibold text-fg-1">接入指引</h2>
          </div>
          <div className="flex flex-col gap-3.5">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">MCP 端点</div>
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
              工具清单与工作流详见平台文档 docs/MCP.md。令牌即以该 Key 的能力与范围调用
              MCP,请勿写入代码仓库或明文分享;泄露请立即吊销。
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
      setError(e instanceof ApiError ? e.message : '保存失败,请重试');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[min(420px,92vw)]">
        <DialogPrimitive.Title className="px-[18px] pb-1 pt-4 text-[15px] font-semibold text-fg-1">
          项目白名单「{k.name}」
        </DialogPrimitive.Title>
        <div className="flex flex-col gap-3 px-[18px] py-3">
          <div className="text-[12px] text-fg-3">Agent 只能访问选中项目内的实体(全部选中 = 不限制)</div>
          <ProjectCheckList projects={projects} selected={sel} onToggle={toggle} maxH="max-h-64" />
          {error && <div className="rounded-lg bg-danger-50 px-3 py-2 text-[12.5px] text-danger">{error}</div>}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-[18px] py-3">
          <div className="flex-1" />
          <Button variant="ghost" size="md" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" size="md" onClick={submit} disabled={sel.length === 0 || update.isPending}>
            保存
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
      setError(e instanceof ApiError ? e.message : '保存失败,请重试');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[min(420px,92vw)]">
        <DialogPrimitive.Title className="px-[18px] pb-1 pt-4 text-[15px] font-semibold text-fg-1">
          修改所属人「{k.name}」
        </DialogPrimitive.Title>
        <div className="flex flex-col gap-3 px-[18px] py-3">
          <div>
            <span className={fieldLabel}>所属人(Agent 以此身份操作)</span>
            <select className={inputCls} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              {!options.some((o) => o.id === ownerId) && (
                <option value={ownerId}>{k.ownerName ?? '当前所属人'}</option>
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
            取消
          </Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!ownerId || update.isPending}>
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
