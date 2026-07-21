'use client';

import * as React from 'react';
import { Plus, Ban } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton, StateBlock } from '@/components/StateBlock';
import { useMcpKeys, useRevokeMcpKey } from '@/store/platform';
import { CreateKeyModal, KeyRevealDialog } from '@/components/platform/CreateKeyModal';
import { PlatformHeader, PopoverConfirm, fmtDate, tdCls, thCls } from '@/components/platform/common';

export default function KeysPage() {
  const { data: keys, isLoading, isError } = useMcpKeys();
  const revoke = useRevokeMcpKey();
  const [modalOpen, setModalOpen] = React.useState(false);
  const [issued, setIssued] = React.useState<{ id: string; key: string; prefix: string } | null>(null);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PlatformHeader title="API Keys" count={keys?.length}>
        <Button variant="primary" size="md" onClick={() => setModalOpen(true)}>
          <Plus size={14} /> 签发 Key
        </Button>
      </PlatformHeader>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <Skeleton rows={5} />
        ) : isError ? (
          <StateBlock icon="alert" tone="danger" title="Key 列表加载失败" body="请稍后重试。" />
        ) : !keys?.length ? (
          <StateBlock
            title="还没有 API Key"
            body="签发 Key 供 MCP / 外部集成访问平台或公司数据。"
            action={
              <Button variant="primary" size="md" onClick={() => setModalOpen(true)}>
                <Plus size={14} /> 签发 Key
              </Button>
            }
          />
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-bg">
              <tr className="border-b border-border">
                <th className={thCls}>名称</th>
                <th className={thCls}>前缀</th>
                <th className={thCls}>范围</th>
                <th className={thCls}>创建人</th>
                <th className={thCls}>创建时间</th>
                <th className={thCls}>状态</th>
                <th className={thCls} style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const revoked = !!k.revokedAt;
                return (
                  <tr key={k.id} className="border-b border-border hover:bg-surface-2/60">
                    <td className={tdCls}>
                      <span className="font-medium">{k.name}</span>
                    </td>
                    <td className={tdCls}>
                      <code className="font-mono text-[12.5px] text-fg-2">{k.prefix}…</code>
                    </td>
                    <td className={tdCls}>{k.companyId ? (k.companyName ?? '—') : '全平台'}</td>
                    <td className={tdCls}>
                      <span className="text-fg-2">{k.createdBy}</span>
                    </td>
                    <td className={tdCls}>
                      <span className="text-fg-3">{fmtDate(k.createdAt)}</span>
                    </td>
                    <td className={tdCls}>
                      <Badge tone={revoked ? 'neutral' : 'success'} dot>
                        {revoked ? '已吊销' : '正常'}
                      </Badge>
                    </td>
                    <td className={tdCls}>
                      {!revoked && (
                        <PopoverConfirm
                          title={`吊销「${k.name}」？`}
                          body="吊销后使用该 Key 的调用将立即失效。"
                          confirmLabel="吊销"
                          busy={revoke.isPending}
                          onConfirm={() => revoke.mutate(k.id)}
                          trigger={
                            <button
                              className="grid h-7 w-7 place-items-center rounded-md text-fg-3 transition-colors hover:bg-danger-50 hover:text-danger"
                              aria-label="吊销"
                            >
                              <Ban size={14} />
                            </button>
                          }
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <CreateKeyModal open={modalOpen} onOpenChange={setModalOpen} onIssued={setIssued} />
      <KeyRevealDialog issued={issued} onClose={() => setIssued(null)} />
    </div>
  );
}
