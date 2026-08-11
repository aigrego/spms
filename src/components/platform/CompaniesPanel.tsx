'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, LogIn, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton, StateBlock } from '@/components/StateBlock';
import { useCompanies, useEnterCompany } from '@/store/platform';
import type { PlatformCompany } from '@/lib/platformApi';
import { CompanyModal } from '@/components/platform/CompanyModal';
import { SeatsDrawer } from '@/components/platform/SeatsDrawer';
import { PlatformHeader, fmtDate } from '@/components/platform/common';
import { useT } from '@/lib/i18n';

export function CompaniesPanel() {
  const router = useRouter();
  const t = useT();
  const { data: companies, isLoading, isError } = useCompanies();
  const enter = useEnterCompany();
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
                  <div className="flex-1" />
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
