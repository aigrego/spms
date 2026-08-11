'use client';

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton, StateBlock } from '@/components/StateBlock';
import { ConfirmDestructive } from '@/components/ConfirmDestructive';
import { useDeleteUser, usePlatformUsers } from '@/store/platform';
import { useAppData } from '@/store/AppData';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { PlatformUser } from '@/lib/platformApi';
import { CreateUserModal } from '@/components/platform/CreateUserModal';
import { LetterAvatar, PlatformHeader, fmtDate, tdCls, thCls } from '@/components/platform/common';

/* 成员管理 = 平台成员目录:系统全部用户及其公司席位。
   席位分配在「公司管理」的公司卡片 → 席位抽屉;公司角色在「研发资源」配置。
   删除用户 = 销账号:先 revoke 其在各家公司的资源池投影(历史记录保留姓名
   快照),再删 users 行;不能删除当前登录账号。 */
export function MembersPanel() {
  const t = useT();
  const { data: users, isLoading, isError } = usePlatformUsers();
  const { session } = useAppData();
  const del = useDeleteUser();
  const [modalOpen, setModalOpen] = React.useState(false);
  const [target, setTarget] = React.useState<PlatformUser | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const confirmDelete = async () => {
    if (!target) return;
    setError(null);
    try {
      await del.mutateAsync(target.userId);
      setTarget(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PlatformHeader title={t('members.title')} count={users?.length}>
        <Button variant="primary" size="md" onClick={() => setModalOpen(true)}>
          <Plus size={14} /> {t('members.newUser')}
        </Button>
      </PlatformHeader>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <Skeleton rows={5} />
        ) : isError ? (
          <StateBlock icon="alert" tone="danger" title={t('members.loadFailed')} body={t('platform.common.retry')} />
        ) : !users?.length ? (
          <StateBlock title={t('members.empty')} body={t('members.emptyBody')} />
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-bg">
              <tr className="border-b border-border">
                <th className={thCls}>{t('members.title')}</th>
                <th className={thCls}>{t('settings.username')}</th>
                <th className={thCls}>{t('members.colPlatformRole')}</th>
                <th className={thCls}>{t('members.colSeats')}</th>
                <th className={thCls}>{t('members.colCreated')}</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId} className="border-b border-border hover:bg-surface-2/60">
                  <td className={tdCls}>
                    <div className="flex items-center gap-2.5">
                      <LetterAvatar name={u.name || u.username} avatarUrl={u.avatarUrl} />
                      <span className="font-medium">{u.name}</span>
                    </div>
                  </td>
                  <td className={tdCls}>
                    <span className="font-mono text-[12.5px] text-fg-2">{u.username}</span>
                  </td>
                  <td className={tdCls}>
                    {u.platformRole === 'admin' ? (
                      <Badge tone="purple">{t('members.admin')}</Badge>
                    ) : (
                      <span className="text-fg-3">{t('members.regular')}</span>
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
                            {s.companyName} · {t(`role.${s.role}`)}
                          </Badge>
                        ))}
                      </span>
                    ) : (
                      <span className="text-fg-3">{t('members.noCompany')}</span>
                    )}
                  </td>
                  <td className={tdCls}>
                    <span className="text-fg-3">{fmtDate(u.createdAt)}</span>
                  </td>
                  <td className={tdCls}>
                    {u.userId !== session?.user.id && (
                      <button
                        className="text-fg-3 hover:text-danger disabled:opacity-40"
                        title={t('members.deleteUser')}
                        disabled={del.isPending}
                        onClick={() => {
                          setError(null);
                          setTarget(u);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {error && <div className="border-t border-border px-4 py-2 text-[12.5px] text-danger">{error}</div>}
      <CreateUserModal open={modalOpen} onOpenChange={setModalOpen} />
      <ConfirmDestructive
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        name={target?.username ?? ''}
        chips={[
          ...(target?.seats.length ? [t('members.chipSeats', { n: target.seats.length })] : []),
          t('members.chipProjection'),
        ]}
        busy={del.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
