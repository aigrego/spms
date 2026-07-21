'use client';

import * as React from 'react';
import { Plus, BookOpen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TabBtn } from '@/components/ui/segmented';
import { Skeleton, StateBlock } from '@/components/StateBlock';
import { useMcpKeys, useRevokeMcpKey, useDeleteMcpKey } from '@/store/platform';
import { CreateKeyModal, KeyRevealDialog } from '@/components/platform/CreateKeyModal';
import { PopoverConfirm, fmtDate, tdCls, thCls } from '@/components/platform/common';
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

function CodeBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface-2 px-3 py-2.5 font-mono text-[12.5px] whitespace-pre text-fg-1">
      {children}
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
  const { session, isPlatformAdmin } = useAppData();
  const [tab, setTab] = React.useState<'mine' | 'all'>('mine');
  const [modalOpen, setModalOpen] = React.useState(false);
  const [issued, setIssued] = React.useState<{ id: string; key: string; prefix: string } | null>(null);

  const myId = session?.user.id ?? null;
  const mine = (keys ?? []).filter((k) => k.createdBy === myId);
  const shown = isPlatformAdmin && tab === 'all' ? (keys ?? []) : mine;

  const endpoint = typeof window !== 'undefined' ? `${window.location.origin}/mcp` : '/mcp';
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
        ) : !shown.length ? (
          <StateBlock
            title={tab === 'mine' ? '你还没有令牌' : '还没有任何令牌'}
            body="新建令牌供 MCP / 编码 Agent 访问平台或公司数据。"
            action={
              <Button variant="primary" size="md" onClick={() => setModalOpen(true)}>
                <Plus size={14} /> 新建令牌
              </Button>
            }
          />
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-bg">
              <tr className="border-b border-border">
                <th className={thCls}>名称</th>
                <th className={thCls}>能力</th>
                <th className={thCls}>范围</th>
                <th className={thCls}>有效期至</th>
                <th className={thCls}>最近使用</th>
                <th className={thCls}>状态</th>
                <th className={thCls} style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {shown.map((k) => {
                const st = statusOf(k);
                const caps = k.capabilities.split(',').map((c) => c.trim()).filter(Boolean);
                return (
                  <tr key={k.id} className="border-b border-border hover:bg-surface-2/60">
                    <td className={tdCls}>
                      <div className="font-medium">{k.name}</div>
                      <code className="font-mono text-[12px] text-fg-3">{k.prefix}…</code>
                    </td>
                    <td className={tdCls}>
                      <span className="inline-flex gap-1.5">
                        {caps.map((c) => (
                          <Badge key={c} tone={CAP_TONE[c] ?? 'neutral'}>
                            {CAP_LABEL[c] ?? c}
                          </Badge>
                        ))}
                      </span>
                    </td>
                    <td className={tdCls}>{k.companyId ? (k.companyName ?? '—') : '全平台'}</td>
                    <td className={tdCls}>
                      <span className="text-fg-2">{k.expiresAt ? fmtDate(k.expiresAt) : '永久'}</span>
                    </td>
                    <td className={tdCls}>
                      <span className="text-fg-3">{k.lastUsedAt ? relativeTime(k.lastUsedAt, t) : '—'}</span>
                    </td>
                    <td className={tdCls}>
                      <Badge tone={st.tone} dot>
                        {st.label}
                      </Badge>
                    </td>
                    <td className={tdCls}>
                      <span className="inline-flex items-center gap-3">
                        {!k.revokedAt && (
                          <PopoverConfirm
                            title={`吊销「${k.name}」?`}
                            body="吊销后使用该令牌的调用将立即失效。"
                            confirmLabel="吊销"
                            busy={revoke.isPending}
                            onConfirm={() => revoke.mutate(k.id)}
                            trigger={
                              <button className="text-[13px] font-medium text-danger hover:underline">
                                吊销
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
                            <button className="text-[13px] font-medium text-fg-3 hover:text-danger hover:underline">
                              删除
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
              <CodeBox>{endpoint}</CodeBox>
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">Claude Code</div>
              <CodeBox>{`claude mcp add --transport http ai-grego-track ${endpoint} --header "Authorization: Bearer spms_…"`}</CodeBox>
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
                Cursor (.cursor/mcp.json)
              </div>
              <CodeBox>{cursorConfig}</CodeBox>
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
    </div>
  );
}
