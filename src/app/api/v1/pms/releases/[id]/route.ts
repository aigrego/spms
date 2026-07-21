import { ok } from '@/lib/envelope';
import { deleteRelease, updateRelease, type UpdateReleaseInput } from '@/server/services/catalog';
import { jsonBody, requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

/* PATCH  /api/v1/pms/releases/:id — partial update.
   DELETE /api/v1/pms/releases/:id — clears subtree assignments, cascades. */
export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await updateRelease(actor, (await ctx.params).id, await jsonBody<UpdateReleaseInput>(req)));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await deleteRelease(actor, (await ctx.params).id));
});
