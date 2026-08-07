import { upload } from '@vercel/blob/client';
import type { AttachmentMeta } from './api';
import { ATTACHMENT_PATH_PREFIX, isAllowedType } from './attachments';

/* Client-direct attachment upload to Vercel Blob. The browser gets an upload
   token from /api/v1/pms/attachments/upload and PUTs the file straight to
   Blob; the returned meta is then registered on the issue via
   api.registerAttachment(). Images + common document formats, 10MB max
   (enforced server-side too). */

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

export async function uploadAttachment(file: File): Promise<AttachmentMeta> {
  if (!isAllowedType(file.type)) {
    throw new Error('不支持的附件格式');
  }
  if (file.size > MAX_ATTACHMENT_SIZE) {
    throw new Error('附件大小需在 10MB 以内');
  }
  // pathname 走签发前缀约定(token 签发端会拒绝前缀外的 pathname)。
  const blob = await upload(`${ATTACHMENT_PATH_PREFIX}${file.name}`, file, {
    access: 'public',
    handleUploadUrl: '/api/v1/pms/attachments/upload',
  });
  return {
    url: blob.url,
    pathname: blob.pathname,
    filename: file.name,
    contentType: file.type,
    size: file.size,
  };
}
