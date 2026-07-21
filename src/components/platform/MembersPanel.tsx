'use client';

import * as React from 'react';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton, StateBlock } from '@/components/StateBlock';
import { usePlatformUsers } from '@/store/platform';
import { ROLE_LABELS } from '@/lib/platformApi';
import { CreateUserModal } from '@/components/platform/CreateUserModal';
import { LetterAvatar, PlatformHeader, fmtDate, tdCls, thCls } from '@/components/platform/common';

/* 成员管理 = 平台成员目录:系统全部用户及其公司席位(只读)。
   席位分配在「公司管理」的公司卡片 → 席位抽屉;公司角色在「研发资源」配置。 */
export function MembersPanel() {
  const { data: users, isLoading, isError } = usePlatformUsers();
  const [modalOpen, setModalOpen] = React.useState(false);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PlatformHeader title="成员" count={users?.length}>
        <Button variant="primary" size="md" onClick={() => setModalOpen(true)}>
          <Plus size={14} /> 新建用户
        </Button>
      </PlatformHeader>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <Skeleton rows={5} />
        ) : isError ? (
          <StateBlock icon="alert" tone="danger" title="成员列表加载失败" body="请稍后重试。" />
        ) : !users?.length ? (
          <StateBlock title="暂无用户" body="新建系统账号后,再到公司卡片分配席位。" />
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-bg">
              <tr className="border-b border-border">
                <th className={thCls}>成员</th>
                <th className={thCls}>用户名</th>
                <th className={thCls}>平台角色</th>
                <th className={thCls}>公司席位</th>
                <th className={thCls}>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId} className="border-b border-border hover:bg-surface-2/60">
                  <td className={tdCls}>
                    <div className="flex items-center gap-2.5">
                      <LetterAvatar name={u.name || u.username} />
                      <span className="font-medium">{u.name}</span>
                    </div>
                  </td>
                  <td className={tdCls}>
                    <span className="font-mono text-[12.5px] text-fg-2">{u.username}</span>
                  </td>
                  <td className={tdCls}>
                    {u.platformRole === 'admin' ? (
                      <Badge tone="purple">管理员</Badge>
                    ) : (
                      <span className="text-fg-3">普通用户</span>
                    )}
                  </td>
                  <td className={tdCls}>
                    {u.seats.length ? (
                      <span className="inline-flex flex-wrap gap-1.5">
                        {u.seats.map((s) => (
                          <Badge key={s.membershipId} tone="neutral">
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ background: s.companyColor || 'var(--slate-500)' }}
                            />
                            {s.companyName} · {ROLE_LABELS[s.role] ?? s.role}
                          </Badge>
                        ))}
                      </span>
                    ) : (
                      <span className="text-fg-3">未加入任何公司</span>
                    )}
                  </td>
                  <td className={tdCls}>
                    <span className="text-fg-3">{fmtDate(u.createdAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <CreateUserModal open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
