import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { ApiException, fail } from '@/lib/envelope';
import { requireActor } from '@/server/http';
import { MAX_ATTACHMENT_SIZE } from '@/server/services/attachments';

/* POST /api/v1/pms/attachments/upload — client-direct upload token for
   @vercel/blob/client's upload(). The blob SDK expects its own response
   shape, so this endpoint returns NextResponse.json(jsonResponse) directly
   instead of the ok() envelope; ApiExceptions still map to fail().
   Registration happens explicitly via /issues/:key/attachments —
   onUploadCompleted is a no-op (webhooks don't fire in local dev). */
export async function POST(req: Request) {
  try {
    const jsonResponse = await handleUpload({
      body: (await req.json()) as HandleUploadBody,
      request: req,
      onBeforeGenerateToken: async () => {
        await requireActor(); // session gate — throws when logged out
        return {
          allowedContentTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'],
          maximumSizeInBytes: MAX_ATTACHMENT_SIZE,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (e) {
    if (e instanceof ApiException) return fail(e.code, e.message, e.status);
    console.error('[api] blob upload error:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
