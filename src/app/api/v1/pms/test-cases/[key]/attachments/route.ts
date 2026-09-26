import { ok } from '@/lib/envelope';
import { registerAttachment, type RegisterAttachmentInput } from '@/server/services/attachments';
import { jsonBody, requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ key: string }> };

/* POST /api/v1/pms/test-cases/:key/attachments — register an already-uploaded
   blob (client-direct upload) as an attachment on this test case. */
export const POST = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(
    await registerAttachment(actor, { type: 'testCase', key: (await ctx.params).key }, await jsonBody<RegisterAttachmentInput>(req)),
  );
});
