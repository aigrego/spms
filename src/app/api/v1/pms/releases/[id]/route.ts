import { ok } from '@/lib/envelope';
import { deleteRelease, updateRelease, type UpdateReleaseInput } from '@/server/services/catalog';
import { jsonBody, requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

/* PATCH  /api/v1/pms/releases/:id — partial update.
   DELETE /api/v1/pms/releases/:id — clears subtree assignments, cascades. */
export const PATCH = route(async (req, ctx: Ctx) => {
  await requireActor();
  return ok(await updateRelease((await ctx.params).id, await jsonBody<UpdateReleaseInput>(req)));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  await requireActor();
  return ok(await deleteRelease((await ctx.params).id));
});
