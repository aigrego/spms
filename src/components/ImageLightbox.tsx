'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useT } from '@/lib/i18n';

/* 图片预览弹窗（公共组件）：给定图片列表与当前下标（null = 关闭），负责
   对话框、左右切换按钮、ArrowLeft/ArrowRight 键盘循环与底部文件名/计数条。
   复用方：AttachmentSection（实体附件区）、设置 → 附件 面板。 */

export interface LightboxImage {
  id: string;
  url: string;
  filename: string;
}

export function ImageLightbox({
  images,
  index,
  onIndexChange,
}: {
  images: LightboxImage[];
  /* 当前预览下标（images 内），null = 关闭。 */
  index: number | null;
  onIndexChange: (index: number | null) => void;
}) {
  const t = useT();
  const open = index !== null;
  const preview = index !== null ? (images[index] ?? null) : null;
  const stepImage = (delta: number) => {
    if (index === null || images.length === 0) return;
    onIndexChange((index + delta + images.length) % images.length);
  };

  // ArrowLeft/ArrowRight cycle the preview while the lightbox is open.
  React.useEffect(() => {
    if (!open || images.length < 2) return;
    const k = (e: KeyboardEvent) => {
      const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      if (delta) onIndexChange(((index ?? 0) + delta + images.length) % images.length);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, images.length, index, onIndexChange]);

  return (
    <Dialog open={!!preview} onOpenChange={(open) => !open && onIndexChange(null)}>
      <DialogContent aria-describedby={undefined} className="w-[min(920px,94vw)] overflow-hidden">
        <DialogPrimitive.Title className="sr-only">{preview?.filename}</DialogPrimitive.Title>
        {preview && (
          <div>
            <div className="relative flex items-center justify-center bg-surface-2">
              <img
                src={preview.url}
                alt={preview.filename}
                className="max-h-[76vh] w-auto max-w-full object-contain"
              />
              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => stepImage(-1)}
                    aria-label={t('issue.prevImage')}
                    title={t('issue.prevImage')}
                    className="absolute left-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/65"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => stepImage(1)}
                    aria-label={t('issue.nextImage')}
                    title={t('issue.nextImage')}
                    className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/65"
                  >
                    <ChevronRight size={18} />
                  </button>
                </>
              )}
            </div>
            <div className="flex items-center gap-2.5 px-4 py-2.5">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-2" title={preview.filename}>
                {preview.filename}
              </span>
              {images.length > 1 && (
                <span className="flex-none text-[12px] tabular-nums text-fg-3">
                  {(index ?? 0) + 1} / {images.length}
                </span>
              )}
              <button
                type="button"
                onClick={() => onIndexChange(null)}
                aria-label={t('issue.closePreview')}
                title={t('issue.closePreview')}
                className="grid h-7 w-7 flex-none place-items-center rounded-[7px] text-fg-3 hover:bg-surface-2 hover:text-fg-1"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
