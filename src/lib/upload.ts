import { upload } from '@vercel/blob/client';
import type { AttachmentMeta } from './api';
import { isAllowedType } from './attachments';

/* Client-direct attachment upload to the company's configured storage backend
   (设置 → 文件存储). Two protocols behind one helper:
   - MinIO: POST create-intent → presigned PUT straight to MinIO.
   - Vercel Blob: POST create-intent → objectKey, then @vercel/blob/client's
     upload() handshake signs that exact pathname (prefix-checked server-side).
   The returned meta.url is the app-internal read proxy (markdown-embeddable);
   registration happens via api.registerAttachment(). 10MB max (enforced
   server-side too). A company without a storage config gets
   STORAGE_NOT_CONFIGURED. */

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

/* 对象 key 的读取代理地址（未注册的粘贴图片用；已注册附件以序列化里的
   ?id= 地址为准）。 */
export const objectReadUrl = (objectKey: string) =>
  `/api/v1/pms/attachments/object?key=${encodeURIComponent(objectKey)}`;

interface Intent {
  mode: 'presigned-put' | 'vercel-token';
  objectKey: string;
  uploadUrl?: string;
}

async function createIntent(file: File): Promise<Intent> {
  const res = await fetch('/api/v1/pms/attachments/upload', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create-intent',
      filename: file.name,
      contentType: file.type,
      size: file.size,
    }),
  });
  const env = (await res.json().catch(() => null)) as
    | { ok: true; data: Intent }
    | { ok: false; error: { code: string; message: string } }
    | null;
  if (!env) throw new Error(`HTTP ${res.status}`);
  if (!env.ok) throw new Error(env.error?.message ?? '上传签发失败');
  return env.data;
}

export async function uploadAttachment(file: File): Promise<AttachmentMeta> {
  if (!isAllowedType(file.type)) {
    throw new Error('不支持的附件格式');
  }
  if (file.size > MAX_ATTACHMENT_SIZE) {
    throw new Error('附件大小需在 10MB 以内');
  }

  const intent = await createIntent(file);

  if (intent.mode === 'presigned-put') {
    // MinIO: 直传到 presigned URL(bucket 需配 CORS 允许本站 PUT)。
    const res = await fetch(intent.uploadUrl!, { method: 'PUT', body: file });
    if (!res.ok) throw new Error(`上传失败（HTTP ${res.status}）`);
    return {
      // url 仅作后端身份标识(注册校验用);展示走代理。
      url: intent.uploadUrl!.split('?')[0]!,
      pathname: intent.objectKey,
      filename: file.name,
      contentType: file.type,
      size: file.size,
    };
  }

  // Vercel Blob: 用签发好的 objectKey 走 blob SDK 握手。
  const blob = await upload(intent.objectKey, file, {
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
