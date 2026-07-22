import { upload } from '@vercel/blob/client';
import type { AttachmentMeta } from './api';

/* Client-direct image upload to Vercel Blob. The browser gets an upload token
   from /api/v1/pms/attachments/upload and PUTs the file straight to Blob;
   the returned meta is then registered on the issue via
   api.registerAttachment(). Images only, 10MB max (enforced server-side too). */

export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

export async function uploadImage(file: File): Promise<AttachmentMeta> {
  if (!file.type.startsWith('image/')) {
    throw new Error('仅支持图片文件');
  }
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error('图片大小需在 10MB 以内');
  }
  const blob = await upload(file.name, file, {
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
