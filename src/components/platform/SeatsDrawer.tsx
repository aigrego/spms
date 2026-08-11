'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton, StateBlock } from '@/components/StateBlock';
import { useAddMember, usePlatformUsers, useRemoveMember } from '@/store/platform';
import { LetterAvatar, PopoverConfirm } from './common';
import { useT } from '@/lib/i18n';
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
  const t = useT();
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
            <h2 className="text-[16px] font-semibold text-fg-1">{t('seats.title')}</h2>
            <p className="mt-0.5 truncate text-[12.5px] text-fg-3">{company.name}</p>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 flex-none place-items-center rounded-md text-fg-3 hover:bg-surface-2"
            aria-label={t('platform.common.close')}
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <Skeleton rows={6} />
          ) : isError ? (
            <StateBlock icon="alert" tone="danger" title={t('seats.loadFailed')} body={t('platform.common.retry')} />
          ) : !users?.length ? (
            <StateBlock title={t('members.empty')} body={t('seats.emptyBody')} />
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border">
                  <th className="px-5 py-2 text-left text-[11.5px] font-semibold text-fg-3">{t('members.title')}</th>
                  <th className="px-3 py-2 text-left text-[11.5px] font-semibold text-fg-3">{t('menu.status')}</th>
                  <th className="px-3 py-2 text-left text-[11.5px] font-semibold text-fg-3">{t('seats.seat')}</th>
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
                          {t('seats.statusOk')}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        {seat ? (
                          <Badge tone="blue" dot>
                            {t('seats.assigned')}
                          </Badge>
                        ) : (
                          <Badge tone="neutral">{t('seats.unassigned')}</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {seat ? (
                          <PopoverConfirm
                            title={t('seats.revokeTitle', { name: u.name })}
                            body={t('seats.revokeBody', { name: company.name })}
                            confirmLabel={t('seats.revoke')}
                            busy={remove.isPending}
                            onConfirm={() => remove.mutate(seat.membershipId)}
                            trigger={
                              <button className="text-[13px] font-medium text-danger hover:underline">{t('seats.revoke')}</button>
                            }
                          />
                        ) : (
                          <button
                            onClick={() => add.mutate({ username: u.username, role: 'viewer' })}
                            disabled={add.isPending && add.variables?.username === u.username}
                            className="text-[13px] font-medium text-brand-blue hover:underline disabled:opacity-40"
                          >
                            {t('seats.assign')}
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
            {t('seats.total', { n: users.length })}
          </div>
        )}
      </aside>
    </>
  );
}
