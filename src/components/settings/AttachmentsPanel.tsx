'use client';

import * as React from 'react';
import { FileText, LayoutGrid, List } from 'lucide-react';
import { Skeleton, StateBlock } from '@/components/StateBlock';
import { PlatformHeader } from '@/components/platform/common';
import { ImageLightbox } from '@/components/ImageLightbox';
import { useCompanyAttachments } from '@/store/attachments';
import { useAppData } from '@/store/AppData';
import { useLocale, useT } from '@/lib/i18n';
import { usePersistentState } from '@/lib/prefs';
import { isImageType } from '@/lib/attachments';
import { formatDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { CompanyAttachment } from '@/lib/types';

/* 设置 → 附件：本公司权限内的全部附件（issues/testcases/requirements 任一
   模块 read 可见，服务端强制公司隔离）。list/grid 两种视图（浏览器记忆），
   点击图片进公共预览弹窗 ImageLightbox，文档新标签页打开。 */

type ViewMode = 'list' | 'grid';
const isViewMode = (v: unknown): v is ViewMode => v === 'list' || v === 'grid';

const formatSize = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const PAGE_SIZE = 24;

export function AttachmentsPanel() {
  const t = useT();
  const locale = useLocale();
  const { memberById } = useAppData();
  const [page, setPage] = React.useState(1);
  const { data, isLoading, isError } = useCompanyAttachments(page, PAGE_SIZE);
  const [viewMode, setViewMode] = usePersistentState<ViewMode>('settings.attachmentsViewMode', 'grid', isViewMode);
  // 预览下标指向图片子集（文档不进弹窗，新标签页打开），null = 关闭。
  const [previewIndex, setPreviewIndex] = React.useState<number | null>(null);

  const items = React.useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const images = React.useMemo(() => items.filter((a) => isImageType(a.contentType)), [items]);

  const openItem = (a: CompanyAttachment) => {
    if (isImageType(a.contentType)) {
      const i = images.findIndex((x) => x.id === a.id);
      if (i >= 0) setPreviewIndex(i);
    } else {
      window.open(a.url, '_blank', 'noopener');
    }
  };

  const ownerText = (a: CompanyAttachment) => (a.owner ? `${a.owner.key} · ${a.owner.title}` : '—');
  const uploaderText = (a: CompanyAttachment) => (a.uploadedById ? (memberById(a.uploadedById)?.name ?? '—') : '—');

  const viewToggle = (
    <div className="inline-flex gap-0.5 rounded-lg bg-surface-2 p-0.5">
      {(
        [
          ['list', List],
          ['grid', LayoutGrid],
        ] as [ViewMode, typeof List][]
      ).map(([m, Ic]) => (
        <button
          key={m}
          type="button"
          onClick={() => setViewMode(m)}
          aria-label={m}
          className={cn(
            'grid h-6 w-[30px] place-items-center rounded-md',
            viewMode === m ? 'bg-surface text-fg-1 shadow-1' : 'text-fg-3',
          )}
        >
          <Ic size={15} />
        </button>
      ))}
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <PlatformHeader title={t('settingsPage.tab.attachments')} />
        <Skeleton rows={6} />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <PlatformHeader title={t('settingsPage.tab.attachments')} />
        <StateBlock icon="alert" tone="danger" title={t('matrix.loadFailed')} body={t('platform.common.retry')} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PlatformHeader title={t('settingsPage.tab.attachments')} count={total}>
        {viewToggle}
      </PlatformHeader>

      {items.length === 0 ? (
        <StateBlock icon="inbox" title={t('attachmentsPanel.empty')} body={t('attachmentsPanel.emptyDesc')} />
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
              {items.map((a) => {
                const image = isImageType(a.contentType);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => openItem(a)}
                    title={a.filename}
                    className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface text-left shadow-1 transition-colors hover:border-border-strong"
                  >
                    <div className="relative aspect-square w-full overflow-hidden bg-surface-2">
                      {image ? (
                        <img
                          src={a.url}
                          alt={a.filename}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <FileText size={28} className="text-fg-3" />
                        </div>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2">
                      <span className="truncate text-[12.5px] font-medium text-fg-1">{a.filename}</span>
                      <span className="truncate text-[11px] text-fg-3">{ownerText(a)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-1">
              <div className="flex items-center gap-3 border-b border-border bg-surface-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
                <span className="min-w-0 flex-1">{t('attachmentsPanel.file')}</span>
                <span className="hidden w-[220px] flex-none md:block">{t('attachmentsPanel.owner')}</span>
                <span className="hidden w-[80px] flex-none text-right sm:block">{t('attachmentsPanel.size')}</span>
                <span className="hidden w-[110px] flex-none lg:block">{t('attachmentsPanel.uploader')}</span>
                <span className="hidden w-[100px] flex-none lg:block">{t('attachmentsPanel.uploadedAt')}</span>
              </div>
              {items.map((a) => {
                const image = isImageType(a.contentType);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => openItem(a)}
                    title={a.filename}
                    className="flex w-full items-center gap-3 border-b border-border px-4 py-2 text-left last:border-b-0 hover:bg-surface-2"
                  >
                    <span className="grid h-9 w-9 flex-none place-items-center overflow-hidden rounded-md border border-border bg-surface-2">
                      {image ? (
                        <img src={a.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <FileText size={15} className="text-fg-3" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg-1">{a.filename}</span>
                    <span className="hidden w-[220px] flex-none truncate text-[12px] text-fg-3 md:block">
                      {ownerText(a)}
                    </span>
                    <span className="hidden w-[80px] flex-none text-right text-[12px] tabular-nums text-fg-3 sm:block">
                      {formatSize(a.size)}
                    </span>
                    <span className="hidden w-[110px] flex-none truncate text-[12px] text-fg-3 lg:block">
                      {uploaderText(a)}
                    </span>
                    <span className="hidden w-[100px] flex-none text-[12px] text-fg-3 lg:block">
                      {formatDate(a.createdAt, locale)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {pages > 1 && (
        <div className="flex flex-none items-center justify-end gap-2 border-t border-border px-6 py-2.5">
          <span className="mr-auto text-[12px] tabular-nums text-fg-3">
            {t('attachmentsPanel.pageInfo', { page, pages, total })}
          </span>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="inline-flex h-7 items-center rounded-lg border border-border bg-surface px-2.5 text-[12.5px] text-fg-2 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('common.prev')}
          </button>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            className="inline-flex h-7 items-center rounded-lg border border-border bg-surface px-2.5 text-[12.5px] text-fg-2 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('common.next')}
          </button>
        </div>
      )}

      <ImageLightbox images={images} index={previewIndex} onIndexChange={setPreviewIndex} />
    </div>
  );
}
