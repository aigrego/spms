import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse, type NextRequest } from 'next/server';
import { ApiException, fail } from '@/lib/envelope';
import { requireActor, route } from '@/server/http';
import { MAX_ATTACHMENT_SIZE } from '@/server/services/attachments';
import { ALLOWED_ATTACHMENT_TYPES, ATTACHMENT_PATH_PREFIX } from '@/lib/attachments';

/* POST /api/v1/pms/attachments/upload — client-direct upload token for
   @vercel/blob/client's upload(). The blob SDK expects its own response
   shape, so this endpoint returns NextResponse.json(jsonResponse) directly
   instead of the ok() envelope; ApiExceptions still map to fail() via route().
   Registration happens explicitly via /issues/:key/attachments —
   onUploadCompleted is a no-op (webhooks don't fire in local dev). */
export const POST = route(async (req: NextRequest) => {
  try {
    const jsonResponse = await handleUpload({
      body: (await req.json()) as HandleUploadBody,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        await requireActor(); // session gate — throws when logged out
        // pathname 前缀约定:签发的 token 只允许落在该前缀下,注册端按同一约定校验。
        if (!pathname.startsWith(ATTACHMENT_PATH_PREFIX)) {
          throw new ApiException('VALIDATION_FAILED', '附件 pathname 与签发前缀不一致');
        }
        return {
          allowedContentTypes: ALLOWED_ATTACHMENT_TYPES,
          maximumSizeInBytes: MAX_ATTACHMENT_SIZE,
          addRandomSuffix: true,
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
