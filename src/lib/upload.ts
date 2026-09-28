import type { AttachmentMeta } from './api';
import { isAllowedType } from './attachments';
import type { AttachmentCategory } from '@/server/storage/types';

/* Client-direct attachment upload over the company's provisioned MinIO
   storage (公司存储行由平台管理员开通,公司不再自助配置). Single protocol:
   POST create-intent → presigned PUT straight to MinIO. The returned
   meta.url is the backend identity marker (registration check); display
   goes through the app-internal read proxy. Registration happens via
   api.registerAttachment(). 10MB max (enforced server-side too). A company
   without a provisioned storage row gets STORAGE_NOT_PROVISIONED; platform
   master switch off gets STORAGE_DISABLED. */

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

/* 对象 key 的读取代理地址（未注册的粘贴图片用；已注册附件以序列化里的
   ?id= 地址为准）。 */
export const objectReadUrl = (objectKey: string) =>
  `/api/v1/pms/attachments/object?key=${encodeURIComponent(objectKey)}`;

interface Intent {
  mode: 'presigned-put';
  objectKey: string;
  uploadUrl?: string;
}

/* category 只是 intent 的受限枚举入参(issues/cases/requirements);key 的
   userSegment 与其余各段一律由服务端铸造,客户端不能指定。 */
async function createIntent(file: File, category: AttachmentCategory): Promise<Intent> {
  const res = await fetch('/api/v1/pms/attachments/upload', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create-intent',
      filename: file.name,
      contentType: file.type,
      size: file.size,
      category,
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

export async function uploadAttachment(file: File, category: AttachmentCategory = 'issues'): Promise<AttachmentMeta> {
  if (!isAllowedType(file.type)) {
    throw new Error('不支持的附件格式');
  }
  if (file.size > MAX_ATTACHMENT_SIZE) {
    throw new Error('附件大小需在 10MB 以内');
  }

  const intent = await createIntent(file, category);

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
