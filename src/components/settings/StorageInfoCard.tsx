'use client';

import * as React from 'react';
import { Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/StateBlock';
import { Card, Row } from '@/components/settings/common';
import { fmtDate } from '@/components/platform/common';
import { useProvisionStorage, useStorageConfig } from '@/store/platform';
import { useT } from '@/lib/i18n';

/* 设置 → 偏好 底部的本公司存储状态卡。平台存储已配置且本公司未开通时
   可一键开通;密钥轮换/重开由平台管理员在 公司管理 操作;secret 永不回显。 */

function Value({ mono, children }: { mono?: boolean; children: React.ReactNode }) {
  return (
    <span className={mono ? 'font-mono text-[12.5px] text-fg-1' : 'text-[13px] text-fg-1'}>{children}</span>
  );
}

export function StorageInfoCard() {
  const t = useT();
  const { data, isLoading } = useStorageConfig();
  const provision = useProvisionStorage();
  const canProvision = !!data && !data.provisioned && data.platformConfigured && data.platformEnabled;

  return (
    <Card title={t('storageCard.title')}>
      {isLoading || !data ? (
        <div className="py-2">
          <Skeleton rows={3} />
        </div>
      ) : !data.provisioned ? (
        <>
          <Row
            label={t('storageCard.status')}
            control={
              canProvision ? (
                <Button variant="secondary" size="sm" disabled={provision.isPending} onClick={() => provision.mutate()}>
                  <Database size={13} /> {t('storageCard.provision')}
                </Button>
              ) : (
                <span className="text-[13px] text-fg-3">{t('storageCard.notProvisioned')}</span>
              )
            }
          />
          {provision.isError ? (
            <p className="m-0 py-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--danger-500, #dc2626)' }}>
              {provision.error.message}
            </p>
          ) : (
            !canProvision && (
              <p className="m-0 py-3 text-[12.5px] leading-relaxed text-fg-3">
                {data.platformConfigured && !data.platformEnabled
                  ? t('storageCard.hintDisabled')
                  : t('storageCard.hintNotConfigured')}
              </p>
            )
          )}
        </>
      ) : (
        <>
          <Row label={t('storageCard.backend')} control={<Value>MinIO</Value>} />
          <Row label={t('storageCard.bucket')} control={<Value>{data.bucket ?? '—'}</Value>} />
          <Row
            label={t('storageCard.endpoint')}
            control={
              <Value>
                {data.publicBaseUrl ??
                  (data.endpoint ? (data.port != null ? `${data.endpoint}:${data.port}` : data.endpoint) : '—')}
              </Value>
            }
          />
          <Row label={t('storageCard.prefix')} control={<Value mono>{data.prefix}</Value>} />
          <Row label={t('storageCard.account')} control={<Value mono>{data.account ?? '—'}</Value>} />
          <Row label={t('storageCard.perms')} desc={t('storageCard.permsDesc')} control={<></>} />
          <Row label={t('storageCard.updatedAt')} control={<Value>{fmtDate(data.updatedAt)}</Value>} />
        </>
      )}
    </Card>
  );
}
