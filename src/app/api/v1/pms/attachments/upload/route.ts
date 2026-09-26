import type { NextRequest } from 'next/server';
import { ApiException, ok } from '@/lib/envelope';
import { requireActor, route } from '@/server/http';
import { MAX_ATTACHMENT_SIZE } from '@/server/services/attachments';
import { isAllowedType } from '@/lib/attachments';
import { ATTACHMENT_CATEGORIES, storageForCompany, type AttachmentCategory } from '@/server/storage';

/* POST /api/v1/pms/attachments/upload — 浏览器直传 MinIO 的签发入口(单一协议):
   body { action:'create-intent', filename, contentType, size, category? } →
   校验登录/类型/大小后按公司存储行返回 { mode:'presigned-put', uploadUrl, objectKey },
   客户端直 PUT 到预签名 URL。category 限枚举 issues|cases|requirements(默认
   issues);对象 key 全部由服务端铸造({companyId}/{category}/{memberId}/
   {fileType}/{uuid}-{safeName}),客户端不能指定 key 的任何一段。公司存储行
   未开通 → STORAGE_NOT_PROVISIONED;平台总开关关闭 → STORAGE_DISABLED。 */

interface IntentBody {
  action: 'create-intent';
  filename?: string;
  contentType?: string;
  size?: number;
  category?: string;
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
  const category = body.category ?? 'issues';
  if (!(ATTACHMENT_CATEGORIES as readonly string[]).includes(category)) {
    throw new ApiException('VALIDATION_FAILED', `未知附件 category（仅支持 ${ATTACHMENT_CATEGORIES.join('/')}）`);
  }
  const storage = await storageForCompany(actor.companyId);
  return ok(
    await storage.createUploadIntent(filename, {
      category: category as AttachmentCategory,
      // userSegment 恒取服务端 actor.memberId（无 member 投影的无座平台管理员
      // 落保留段 system）——客户端不能指定 key 的任何一段。
      userSegment: actor.memberId ?? 'system',
      contentType,
    }),
  );
});
