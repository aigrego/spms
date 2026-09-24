'use client';

import * as React from 'react';
import { Skeleton } from '@/components/StateBlock';
import { Card, Row } from '@/components/settings/common';
import { fmtDate } from '@/components/platform/common';
import { useStorageConfig } from '@/store/platform';
import { useT } from '@/lib/i18n';

/* 设置 → 偏好 底部的本公司存储状态卡(只读)。开通/重开由平台管理员在
   公司管理操作,公司侧不再自助配置;secret 永不回显。 */

function Value({ mono, children }: { mono?: boolean; children: React.ReactNode }) {
  return (
    <span className={mono ? 'font-mono text-[12.5px] text-fg-1' : 'text-[13px] text-fg-1'}>{children}</span>
  );
}

export function StorageInfoCard() {
  const t = useT();
  const { data, isLoading } = useStorageConfig();

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
            control={<span className="text-[13px] text-fg-3">{t('storageCard.notProvisioned')}</span>}
          />
          <p className="m-0 py-3 text-[12.5px] leading-relaxed text-fg-3">
            {data.platformConfigured && !data.platformEnabled
              ? t('storageCard.hintDisabled')
              : t('storageCard.hintNotConfigured')}
          </p>
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
