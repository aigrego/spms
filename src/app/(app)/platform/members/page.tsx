'use client';

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton, StateBlock } from '@/components/StateBlock';
import { useCompanies, useCompanyMembers, useRemoveMember, useUpdateMemberRole } from '@/store/platform';
import { ROLE_LABELS } from '@/lib/platformApi';
import type { CompanyRole } from '@/lib/platformApi';
import { AddMemberModal } from '@/components/platform/AddMemberModal';
import { LetterAvatar, PlatformHeader, PopoverConfirm, fmtDate, inputCls, tdCls, thCls } from '@/components/platform/common';

export default function MembersPage() {
  const { data: companies = [], isLoading: companiesLoading } = useCompanies();
  const [companyId, setCompanyId] = React.useState<string>('');

  // 默认选中第一个公司
  React.useEffect(() => {
    if (!companyId && companies.length > 0) setCompanyId(companies[0].id);
  }, [companies, companyId]);

  const { data: members, isLoading, isError } = useCompanyMembers(companyId || null);
  const setRole = useUpdateMemberRole(companyId);
  const remove = useRemoveMember(companyId);
  const [modalOpen, setModalOpen] = React.useState(false);

  const company = companies.find((c) => c.id === companyId);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PlatformHeader title="成员" count={members?.length}>
        <select
          className={inputCls}
          style={{ width: 200 }}
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          disabled={companiesLoading || companies.length === 0}
        >
          {companies.length === 0 && <option value="">暂无公司</option>}
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button variant="primary" size="md" onClick={() => setModalOpen(true)} disabled={!companyId}>
          <Plus size={14} /> 添加成员
        </Button>
      </PlatformHeader>
      <div className="flex-1 overflow-y-auto">
        {!companyId && !companiesLoading ? (
          <StateBlock title="暂无公司" body="请先在「公司」页创建公司，再回到这里管理成员。" />
        ) : isLoading ? (
          <Skeleton rows={5} />
        ) : isError ? (
          <StateBlock icon="alert" tone="danger" title="成员列表加载失败" body="请稍后重试。" />
        ) : !members?.length ? (
          <StateBlock title="暂无成员" body="添加成员后，他们将按角色访问该公司沙箱。" />
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-bg">
              <tr className="border-b border-border">
                <th className={thCls}>成员</th>
                <th className={thCls}>用户名</th>
                <th className={thCls}>角色</th>
                <th className={thCls}>加入时间</th>
                <th className={thCls} style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.membershipId} className="border-b border-border hover:bg-surface-2/60">
                  <td className={tdCls}>
                    <div className="flex items-center gap-2.5">
                      <LetterAvatar name={m.user.name || m.user.username} />
                      <span className="font-medium">{m.user.name}</span>
                    </div>
                  </td>
                  <td className={tdCls}>
                    <span className="font-mono text-[12.5px] text-fg-2">{m.user.username}</span>
                  </td>
                  <td className={tdCls}>
                    <select
                      className="h-7 rounded-md border border-border-strong bg-surface px-1.5 text-[12.5px] text-fg-1 outline-none focus:border-brand-blue"
                      value={m.role}
                      onChange={(e) =>
                        setRole.mutate({ membershipId: m.membershipId, role: e.target.value as CompanyRole })
                      }
                      disabled={setRole.isPending && setRole.variables?.membershipId === m.membershipId}
                    >
                      {(Object.keys(ROLE_LABELS) as CompanyRole[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={tdCls}>
                    <span className="text-fg-3">{fmtDate(m.createdAt)}</span>
                  </td>
                  <td className={tdCls}>
                    <PopoverConfirm
                      title={`移除成员「${m.user.name}」？`}
                      body="移除后该用户将无法再访问此公司沙箱。"
                      confirmLabel="移除"
                      busy={remove.isPending}
                      onConfirm={() => remove.mutate(m.membershipId)}
                      trigger={
                        <button
                          className="grid h-7 w-7 place-items-center rounded-md text-fg-3 transition-colors hover:bg-danger-50 hover:text-danger"
                          aria-label="移除"
                        >
                          <Trash2 size={14} />
                        </button>
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {company && <AddMemberModal open={modalOpen} onOpenChange={setModalOpen} companyId={company.id} />}
    </div>
  );
}
