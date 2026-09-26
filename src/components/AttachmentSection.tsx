'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, FileText, Loader2, Paperclip, Plus, X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useT } from '@/lib/i18n';
import { ATTACHMENT_ACCEPT, isImageType } from '@/lib/attachments';
import type { IssueAttachment } from '@/lib/types';

/* Shared attachment section (issues / test cases / requirements detail views).
   Owns the whole block: header + add button, hidden file input, in-flight
   upload tiles, error banner, thumbnail grid with delete, and the image
   lightbox (documents open in a new tab instead). The parent supplies the
   entity wiring: onUpload = uploadAttachment(file, category) + register
   mutation; onDelete = delete mutation.

   空态:无附件且无在传时不渲染列表(头部与「添加附件」按钮常在)。
   10MB/格式限制文案复用上传链路的报错(flash 横幅,6s 自动消失)。 */

export interface AttachmentSectionHandle {
  /* 宿主粘贴流(如 issue 描述编辑态粘贴图)复用同一上传链路。 */
  uploadFiles: (files: Iterable<File>) => void;
}

export function AttachmentSection({
  items,
  onUpload,
  onDelete,
  busy,
  onPreviewOpenChange,
  ref,
}: {
  items: IssueAttachment[];
  /* 上传并注册一个文件;reject 时在区块内 flash 错误横幅。 */
  onUpload: (file: File) => Promise<unknown>;
  onDelete: (id: string) => void;
  /* 注册/删除 mutation 进行中(禁用添加/删除按钮,防重复提交)。 */
  busy?: boolean;
  /* lightbox 开闭回调:宿主抽屉的 Escape 处理据此协调(lightbox 开着时
     Escape 只关 lightbox 不关抽屉)。 */
  onPreviewOpenChange?: (open: boolean) => void;
  ref?: React.Ref<AttachmentSectionHandle>;
}) {
  const t = useT();
  // In-flight uploads (object uploaded, registration pending) — shown as dimmed tiles.
  const [uploading, setUploading] = React.useState<{ key: string; preview: string; image: boolean }[]>([]);
  // 上传失败原因(如 STORAGE_NOT_CONFIGURED)的短暂横幅提示。
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const flashUploadError = (msg: string) => {
    setUploadError(msg);
    setTimeout(() => setUploadError(null), 6000);
  };
  const attachInputRef = React.useRef<HTMLInputElement>(null);
  // Image preview lightbox: index into the image-only attachment list (documents
  // open in a new tab instead), null = closed.
  const [previewIndex, setPreviewIndex] = React.useState<number | null>(null);
  const previewOpen = previewIndex !== null;

  React.useEffect(() => {
    onPreviewOpenChange?.(previewOpen);
  }, [previewOpen, onPreviewOpenChange]);

  // Current lightbox attachment + wrap-around stepping across image attachments
  // only (documents never enter the lightbox — they open in a new tab).
  const imageAttachments = items.filter((a) => isImageType(a.contentType));
  const preview = previewIndex !== null ? (imageAttachments[previewIndex] ?? null) : null;
  const stepImage = (delta: number) =>
    setPreviewIndex((i) => (i === null ? i : (i + delta + imageAttachments.length) % imageAttachments.length));

  // ArrowLeft/ArrowRight cycle the preview while the lightbox is open.
  React.useEffect(() => {
    if (!previewOpen || imageAttachments.length < 2) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setPreviewIndex((i) => (i === null ? i : (i - 1 + imageAttachments.length) % imageAttachments.length));
      if (e.key === 'ArrowRight') setPreviewIndex((i) => (i === null ? i : (i + 1) % imageAttachments.length));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [previewOpen, imageAttachments.length]);

  // Upload each picked file straight to the storage backend, then the parent
  // registers it on the entity (onUpload resolves when registration settles).
  const uploadFiles = React.useCallback(
    (files: Iterable<File>) => {
      for (const file of files) {
        const key = crypto.randomUUID();
        const image = isImageType(file.type);
        setUploading((u) => [...u, { key, preview: image ? URL.createObjectURL(file) : '', image }]);
        Promise.resolve()
          .then(() => onUpload(file))
          .catch((e) => flashUploadError(e instanceof Error && e.message ? e.message : t('issue.uploadFailed')))
          .finally(() => setUploading((u) => u.filter((x) => x.key !== key)));
      }
    },
    [onUpload, t],
  );
  React.useImperativeHandle(ref, () => ({ uploadFiles }), [uploadFiles]);

  const removeAttachment = (attachmentId: string) => {
    if (window.confirm(t('issue.confirmDeleteAttachment'))) {
      onDelete(attachmentId);
    }
  };

  return (
    <div className="mb-[22px]">
      <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-fg-2">
        <Paperclip size={14} className="text-fg-3" /> {t('issue.attachments')}
        {items.length > 0 && <> · {items.length}</>}
        <div className="flex-1" />
        <button
          onClick={() => attachInputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-[7px] px-2 py-1 text-[12.5px] font-medium text-fg-2 hover:bg-surface-2 disabled:opacity-50"
        >
          <Plus size={13} className="text-fg-3" /> {t('issue.attachImage')}
        </button>
      </div>
      {uploadError && (
        <div className="mb-2 rounded-lg border border-danger/40 bg-danger/5 px-3 py-1.5 text-[12.5px] text-danger">
          {uploadError}
        </div>
      )}
      {(items.length > 0 || uploading.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {items.map((a) => {
            const image = isImageType(a.contentType);
            return (
              <div
                key={a.id}
                title={a.filename}
                className="group relative h-16 w-16 overflow-hidden rounded-lg border border-border"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (image) {
                      setPreviewIndex(imageAttachments.findIndex((x) => x.id === a.id));
                    } else {
                      window.open(a.url, '_blank', 'noopener');
                    }
                  }}
                  aria-label={a.filename}
                  className="block h-full w-full cursor-pointer"
                >
                  {image ? (
                    <img src={a.url} alt={a.filename} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-surface-2 px-1">
                      <FileText size={16} className="flex-none text-fg-3" />
                      <span className="w-full truncate text-center text-[10px] leading-tight text-fg-2">
                        {a.filename}
                      </span>
                    </div>
                  )}
                </button>
                <button
                  onClick={() => removeAttachment(a.id)}
                  disabled={busy}
                  aria-label="delete"
                  className="absolute right-0.5 top-0.5 hidden h-4 w-4 place-items-center rounded-full bg-black/55 text-white hover:bg-black/75 group-hover:grid"
                >
                  <X size={10} />
                </button>
              </div>
            );
          })}
          {uploading.map((u) => (
            <div key={u.key} className="relative h-16 w-16 overflow-hidden rounded-lg border border-border">
              {u.image ? (
                <img src={u.preview} alt="" className="h-full w-full object-cover opacity-60" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-surface-2">
                  <FileText size={16} className="text-fg-3" />
                </div>
              )}
              <div className="absolute inset-0 grid place-items-center">
                <Loader2 size={16} className="animate-spin text-fg-2" />
              </div>
            </div>
          ))}
        </div>
      )}
      <input
        ref={attachInputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) uploadFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Attachment image lightbox — replaces opening the blob URL in a new tab */}
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreviewIndex(null)}>
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
                {imageAttachments.length > 1 && (
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
                {imageAttachments.length > 1 && (
                  <span className="flex-none text-[12px] tabular-nums text-fg-3">
                    {(previewIndex ?? 0) + 1} / {imageAttachments.length}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewIndex(null)}
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
    </div>
  );
}
