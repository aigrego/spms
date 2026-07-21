'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton, StateBlock } from '@/components/StateBlock';
import { useAddMember, usePlatformUsers, useRemoveMember } from '@/store/platform';
import { LetterAvatar, PopoverConfirm } from './common';
import type { PlatformCompany } from '@/lib/platformApi';

/* 席位管理抽屉:列出平台全部用户,把用户加入(分配)或移出(回收)某个
   公司沙箱。分配的默认公司角色是「访客」,之后可在研发资源页调整。 */
export function SeatsDrawer({
  company,
  onClose,
}: {
  company: PlatformCompany | null;
  onClose: () => void;
}) {
  const { data: users, isLoading, isError } = usePlatformUsers();
  const add = useAddMember(company?.id ?? '');
  const remove = useRemoveMember(company?.id ?? '');

  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  if (!company) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-[min(560px,92vw)] flex-col border-l border-border bg-surface shadow-3">
        <div className="flex flex-none items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold text-fg-1">席位管理</h2>
            <p className="mt-0.5 truncate text-[12.5px] text-fg-3">{company.name}</p>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 flex-none place-items-center rounded-md text-fg-3 hover:bg-surface-2"
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <Skeleton rows={6} />
          ) : isError ? (
            <StateBlock icon="alert" tone="danger" title="用户列表加载失败" body="请稍后重试。" />
          ) : !users?.length ? (
            <StateBlock title="暂无用户" body="先在「成员管理」新建系统账号。" />
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border">
                  <th className="px-5 py-2 text-left text-[11.5px] font-semibold text-fg-3">成员</th>
                  <th className="px-3 py-2 text-left text-[11.5px] font-semibold text-fg-3">状态</th>
                  <th className="px-3 py-2 text-left text-[11.5px] font-semibold text-fg-3">席位</th>
                  <th className="px-3 py-2 text-left text-[11.5px] font-semibold text-fg-3" style={{ width: 64 }} />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const seat = u.seats.find((s) => s.companyId === company.id);
                  return (
                    <tr key={u.userId} className="border-b border-border hover:bg-surface-2/60">
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <LetterAvatar name={u.name || u.username} />
                          <div className="min-w-0">
                            <div className="truncate text-[13.5px] font-medium text-fg-1">{u.name}</div>
                            <div className="truncate font-mono text-[12px] text-fg-3">{u.username}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone="success" dot>
                          正常
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        {seat ? (
                          <Badge tone="blue" dot>
                            已分配
                          </Badge>
                        ) : (
                          <Badge tone="neutral">未分配</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {seat ? (
                          <PopoverConfirm
                            title={`回收「${u.name}」的席位?`}
                            body={`回收后该用户将无法再进入「${company.name}」沙箱。`}
                            confirmLabel="回收"
                            busy={remove.isPending}
                            onConfirm={() => remove.mutate(seat.membershipId)}
                            trigger={
                              <button className="text-[13px] font-medium text-danger hover:underline">回收</button>
                            }
                          />
                        ) : (
                          <button
                            onClick={() => add.mutate({ username: u.username, role: 'viewer' })}
                            disabled={add.isPending && add.variables?.username === u.username}
                            className="text-[13px] font-medium text-brand-blue hover:underline disabled:opacity-40"
                          >
                            分配
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {users && users.length > 0 && (
          <div className="flex-none border-t border-border px-5 py-2.5 text-[12px] text-fg-3">
            共 {users.length} 条
          </div>
        )}
      </aside>
    </>
  );
}
