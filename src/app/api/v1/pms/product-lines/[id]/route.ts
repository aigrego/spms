import { ok } from '@/lib/envelope';
import { deleteProductLine, updateProductLine } from '@/server/services/catalog';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, productLineUpdateSchema } from '@/server/validate';

type Ctx = { params: Promise<{ id: string }> };

/* PATCH  /api/v1/pms/product-lines/:id — partial update.
   DELETE /api/v1/pms/product-lines/:id — clears subtree assignments, cascades. */
export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await updateProductLine(actor, (await ctx.params).id, await jsonBodyWith(req, productLineUpdateSchema)));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await deleteProductLine(actor, (await ctx.params).id));
});
