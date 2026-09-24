import type { NextRequest } from 'next/server';
import { ApiException, ok } from '@/lib/envelope';
import { requireActor, route } from '@/server/http';
import { MAX_ATTACHMENT_SIZE } from '@/server/services/attachments';
import { isAllowedType } from '@/lib/attachments';
import { storageForCompany } from '@/server/storage';

/* POST /api/v1/pms/attachments/upload — 浏览器直传 MinIO 的签发入口(单一协议):
   body { action:'create-intent', filename, contentType, size } → 校验登录/类型/
   大小后按公司存储行返回 { mode:'presigned-put', uploadUrl, objectKey },
   客户端直 PUT 到预签名 URL。公司存储行未开通 → STORAGE_NOT_PROVISIONED;
   平台总开关关闭 → STORAGE_DISABLED。 */

interface IntentBody {
  action: 'create-intent';
  filename?: string;
  contentType?: string;
  size?: number;
}

export const POST = route(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as IntentBody | null;
  if (body?.action !== 'create-intent') {
    throw new ApiException('VALIDATION_FAILED', '未知 action');
  }
  const actor = await requireActor();
  const { filename, contentType, size } = body;
  if (!filename || !contentType || !isAllowedType(contentType)) {
    throw new ApiException('VALIDATION_FAILED', '不支持的附件格式');
  }
  if (!Number.isFinite(size) || !size || size <= 0 || size > MAX_ATTACHMENT_SIZE) {
    throw new ApiException('VALIDATION_FAILED', '附件大小需在 10MB 以内');
  }
  const storage = await storageForCompany(actor.companyId);
  return ok(await storage.createUploadIntent(filename));
});
