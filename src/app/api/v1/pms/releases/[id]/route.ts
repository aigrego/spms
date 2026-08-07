import { ok } from '@/lib/envelope';
import { deleteRelease, updateRelease } from '@/server/services/catalog';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, releaseUpdateSchema } from '@/server/validate';

type Ctx = { params: Promise<{ id: string }> };

/* PATCH  /api/v1/pms/releases/:id — partial update.
   DELETE /api/v1/pms/releases/:id — clears subtree assignments, cascades. */
export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await updateRelease(actor, (await ctx.params).id, await jsonBodyWith(req, releaseUpdateSchema)));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await deleteRelease(actor, (await ctx.params).id));
});
