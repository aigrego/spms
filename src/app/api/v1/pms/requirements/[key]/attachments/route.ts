import { ok } from '@/lib/envelope';
import { registerAttachment, type RegisterAttachmentInput } from '@/server/services/attachments';
import { jsonBody, requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ key: string }> };

/* POST /api/v1/pms/requirements/:key/attachments — register an already-uploaded
   blob (client-direct upload) as an attachment on this requirement. */
export const POST = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(
    await registerAttachment(actor, { type: 'requirement', key: (await ctx.params).key }, await jsonBody<RegisterAttachmentInput>(req)),
  );
});
