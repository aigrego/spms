import { ok } from '@/lib/envelope';
import { registerAttachment, type RegisterAttachmentInput } from '@/server/services/attachments';
import { jsonBody, requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ key: string }> };

/* POST /api/v1/pms/issues/:key/attachments — register an already-uploaded
   blob (client-direct upload) as an attachment on this issue. */
export const POST = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await registerAttachment(actor, (await ctx.params).key, await jsonBody<RegisterAttachmentInput>(req)));
});
