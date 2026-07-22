import { ok } from '@/lib/envelope';
import { deleteAttachment } from '@/server/services/attachments';
import { requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

/* DELETE /api/v1/pms/attachments/:id — remove the blob + row. */
export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await deleteAttachment(actor, (await ctx.params).id));
});
