/* Shared attachment allow-list: images plus common document formats
   (xlsx/docx/pptx/pdf/…). Used by the browser file pickers (accept), the
   client upload helper, and the server-side registration validation, so all
   three stay in sync. The object-key rule
   (`{companyId}/{category}/{userSegment}/{fileType}/{uuid}-{safeName}`) lives
   in src/server/storage/types.ts; the fileType segment is derived here
   (fileTypeOf). */

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];

export const ALLOWED_DOC_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
  'text/csv',
  'text/plain',
  'text/markdown',
];

export const ALLOWED_ATTACHMENT_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOC_TYPES];

// <input accept> string — extensions are more reliable than MIME on some OSes.
export const ATTACHMENT_ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md';

export const isImageType = (contentType: string) => contentType.startsWith('image/');

export const isAllowedType = (contentType: string) =>
  isImageType(contentType) || ALLOWED_DOC_TYPES.includes(contentType);

/* fileType 段推导（对象 key 第四段）：image/* → images；ALLOWED_DOC_TYPES →
   documents；其余/空 → others。不做魔数嗅探；新上传的 contentType 已过
   allow-list，实际只落 images/documents，others 为历史行兜底。 */
export type AttachmentFileType = 'images' | 'documents' | 'others';

export function fileTypeOf(contentType: string | null | undefined): AttachmentFileType {
  if (!contentType) return 'others';
  if (isImageType(contentType)) return 'images';
  if (ALLOWED_DOC_TYPES.includes(contentType)) return 'documents';
  return 'others';
}
