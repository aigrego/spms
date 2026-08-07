/* Shared attachment allow-list: images (same five the blob token route has
   always accepted) plus common document formats (xlsx/docx/pptx/pdf/…).
   Used by the browser file pickers (accept), the client upload helper, and
   the server-side registration validation, so all three stay in sync. */

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

/* Blob pathname 的签发前缀约定:浏览器 client-direct 上传与服务端 put
   (MCP/Notion 同步)都落在该前缀下;upload token 签发端拒绝其他 pathname,
   注册端(registerAttachment)用同一前缀校验附件归属。 */
export const ATTACHMENT_PATH_PREFIX = 'issues/';

// <input accept> string — extensions are more reliable than MIME on some OSes.
export const ATTACHMENT_ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md';

export const isImageType = (contentType: string) => contentType.startsWith('image/');

export const isAllowedType = (contentType: string) =>
  isImageType(contentType) || ALLOWED_DOC_TYPES.includes(contentType);
