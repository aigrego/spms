import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse, type NextRequest } from 'next/server';
import { ApiException, fail, ok } from '@/lib/envelope';
import { requireActor, route } from '@/server/http';
import { MAX_ATTACHMENT_SIZE } from '@/server/services/attachments';
import { ALLOWED_ATTACHMENT_TYPES, isAllowedType } from '@/lib/attachments';
import { objectKeyPrefix, storageForCompany } from '@/server/storage';

/* POST /api/v1/pms/attachments/upload — 浏览器直传的签发入口,两种协议:
   1) 自家意图协议:body { action:'create-intent', filename, contentType, size }
      → 校验登录/类型/大小后按公司存储后端返回
      { mode:'presigned-put', uploadUrl, objectKey } (MinIO) 或
      { mode:'vercel-token', objectKey } (Vercel,客户端再走去下方 2) 的握手)。
   2) @vercel/blob/client 的 handleUpload 握手(仅公司后端为 vercel_blob 时):
      blob SDK 期望自己的响应形态,直接返回 NextResponse.json(jsonResponse)。
   公司无存储配置 → STORAGE_NOT_CONFIGURED(无平台级兜底)。 */

interface IntentBody {
  action: 'create-intent';
  filename?: string;
  contentType?: string;
  size?: number;
}

export const POST = route(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);

  // ---- 自家意图协议 ----
  if ((body as IntentBody | null)?.action === 'create-intent') {
    const actor = await requireActor();
    const { filename, contentType, size } = body as IntentBody;
    if (!filename || !contentType || !isAllowedType(contentType)) {
      throw new ApiException('VALIDATION_FAILED', '不支持的附件格式');
    }
    if (!Number.isFinite(size) || !size || size <= 0 || size > MAX_ATTACHMENT_SIZE) {
      throw new ApiException('VALIDATION_FAILED', '附件大小需在 10MB 以内');
    }
    const storage = await storageForCompany(actor.companyId); // 无配置即抛错
    return ok(await storage.createUploadIntent(filename));
  }

  // ---- @vercel/blob/client 握手 ----
  try {
    const jsonResponse = await handleUpload({
      body: body as HandleUploadBody,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const actor = await requireActor(); // session gate — throws when logged out
        const storage = await storageForCompany(actor.companyId);
        if (storage.kind !== 'vercel_blob' || !storage.vercelToken) {
          throw new ApiException('VALIDATION_FAILED', '本公司存储后端不是 Vercel Blob');
        }
        // pathname 前缀约定:签发的 token 只允许落在本公司前缀下,注册端同一约定校验。
        if (!pathname.startsWith(objectKeyPrefix(actor.companyId))) {
          throw new ApiException('VALIDATION_FAILED', '附件 pathname 与签发前缀不一致');
        }
        return {
          allowedContentTypes: ALLOWED_ATTACHMENT_TYPES,
          maximumSizeInBytes: MAX_ATTACHMENT_SIZE,
          token: storage.vercelToken,
          addRandomSuffix: false, // objectKey 已含 uuid,不再追加随机后缀
        };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (e) {
    // ApiException(鉴权/前缀校验)交给 route() 统一映射 envelope;blob SDK 的
    // 客户端错误不再裸抛内部 message,统一成 fail() envelope(HTTP 400)。
    if (e instanceof ApiException) throw e;
    console.error('[api] blob upload error:', e);
    return fail('VALIDATION_FAILED', '附件上传请求不合法', 400);
  }
});
