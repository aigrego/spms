'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, LogIn, Users, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton, StateBlock } from '@/components/StateBlock';
import { useCompanies, useEnterCompany, usePlatformStorageConfig, useProvisionCompanyStorage } from '@/store/platform';
import type { PlatformCompany } from '@/lib/platformApi';
import { CompanyModal } from '@/components/platform/CompanyModal';
import { SeatsDrawer } from '@/components/platform/SeatsDrawer';
import { PlatformHeader, PopoverConfirm, fmtDate } from '@/components/platform/common';
import { useT } from '@/lib/i18n';

export function CompaniesPanel() {
  const router = useRouter();
  const t = useT();
  const { data: companies, isLoading, isError } = useCompanies();
  const enter = useEnterCompany();
  /* 开通存储依赖平台存储已配置(设置→平台存储);未配置时按钮禁用并提示。 */
  const platformStorage = usePlatformStorageConfig();
  const provision = useProvisionCompanyStorage();
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editCompany, setEditCompany] = React.useState<PlatformCompany | null>(null);
  const [seatsCompany, setSeatsCompany] = React.useState<PlatformCompany | null>(null);

  const openNew = () => {
    setEditCompany(null);
    setModalOpen(true);
  };
  const openEdit = (c: PlatformCompany) => {
    setEditCompany(c);
    setModalOpen(true);
  };

  const enterSandbox = (c: PlatformCompany) => {
    enter.mutate(c.id, { onSuccess: () => router.push('/issues') });
  };

  /* 存储状态小字:storageMode 'auto' = 平台开通 / 'manual' = 历史手动配置 / null = 未开通。 */
  const storageStatus = (c: PlatformCompany) => {
    const [label, color] =
      c.storageMode === 'auto'
        ? [t('companies.storage.status.provisioned'), 'var(--success-500)']
        : c.storageMode === 'manual'
          ? [t('companies.storage.status.manual'), 'var(--warning-500, #d97706)']
          : [t('companies.storage.status.none'), 'var(--fg-3)'];
    return (
      <span className="inline-flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        {label}
      </span>
    );
  };

  /* 开通存储按钮四态:平台未配置禁用;未开通直接开通;manual 先确认覆盖;
     已开通(auto)文案「重新开通」,确认后 force 轮换密钥。 */
  const provisionBtn = (c: PlatformCompany) => {
    const label = c.storageMode === 'auto' ? t('companies.storage.reprovision') : t('companies.storage.provision');
    const busy = provision.isPending && provision.variables?.id === c.id;
    if (!platformStorage.data?.configured) {
      return (
        <span title={t('companies.storage.notConfiguredHint')} className="inline-flex">
          <Button variant="secondary" size="sm" disabled>
            <Database size={13} /> {label}
          </Button>
        </span>
      );
    }
    const btn = (
      <Button variant="secondary" size="sm" disabled={busy} onClick={c.storageMode ? undefined : () => provision.mutate({ id: c.id })}>
        <Database size={13} /> {label}
      </Button>
    );
    if (c.storageMode === 'manual') {
      return (
        <PopoverConfirm
          trigger={btn}
          title={label}
          body={t('companies.storage.provisionConfirm')}
          busy={busy}
          onConfirm={() => provision.mutate({ id: c.id })}
        />
      );
    }
    if (c.storageMode === 'auto') {
      return (
        <PopoverConfirm
          trigger={btn}
          title={label}
          body={t('companies.storage.reprovisionConfirm')}
          busy={busy}
          onConfirm={() => provision.mutate({ id: c.id, force: true })}
        />
      );
    }
    return btn;
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PlatformHeader title={t('companies.title')} count={companies?.length}>
        <Button variant="primary" size="md" onClick={openNew}>
          <Plus size={14} /> {t('companies.new')}
        </Button>
      </PlatformHeader>
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <Skeleton rows={5} />
        ) : isError ? (
          <StateBlock icon="alert" tone="danger" title={t('companies.loadFailed')} body={t('companies.loadFailedBody')} />
        ) : !companies?.length ? (
          <StateBlock
            title={t('companies.empty')}
            body={t('companies.emptyBody')}
            action={
              <Button variant="primary" size="md" onClick={openNew}>
                <Plus size={14} /> {t('companies.new')}
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
            {companies.map((c) => (
              <div key={c.id} className="lift-card group rounded-[14px] border border-border bg-surface p-[18px] shadow-1">
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="h-9 w-9 flex-none rounded-[10px]" style={{ background: c.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold text-fg-1">{c.name}</div>
                    <div className="font-mono text-[11.5px] text-fg-3">{c.key}</div>
                  </div>
                  <button
                    onClick={() => openEdit(c)}
                    className="grid h-7 w-7 place-items-center rounded-md text-fg-3 opacity-0 transition-opacity hover:bg-surface-2 group-hover:opacity-100"
                    aria-label={t('platform.common.edit')}
                  >
                    <Pencil size={14} />
                  </button>
                </div>
                <p className="mb-3 min-h-[20px] truncate text-[13px] leading-normal text-fg-2">
                  {c.description || <span className="text-fg-3">{t('companies.noDesc')}</span>}
                </p>
                <div className="flex items-center gap-3 border-t border-border pt-3 text-[12px] text-fg-3">
                  <span className="inline-flex items-center gap-1">
                    <Users size={13} />
                    {t('companies.memberCount', { n: c.memberCount })}
                  </span>
                  <span>{t('companies.createdAt', { date: fmtDate(c.createdAt) })}</span>
                  {storageStatus(c)}
                  <div className="flex-1" />
                  {provisionBtn(c)}
                  <Button variant="secondary" size="sm" onClick={() => setSeatsCompany(c)}>
                    {t('seats.seat')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => enterSandbox(c)}
                    disabled={enter.isPending && enter.variables === c.id}
                  >
                    <LogIn size={13} /> {t('companies.enter')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <CompanyModal open={modalOpen} onOpenChange={setModalOpen} company={editCompany} />
      {seatsCompany && <SeatsDrawer company={seatsCompany} onClose={() => setSeatsCompany(null)} />}
    </div>
  );
}
