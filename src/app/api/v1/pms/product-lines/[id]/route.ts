import { ok } from '@/lib/envelope';
import { deleteProductLine, updateProductLine, type UpdateProductLineInput } from '@/server/services/catalog';
import { jsonBody, requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

/* PATCH  /api/v1/pms/product-lines/:id — partial update.
   DELETE /api/v1/pms/product-lines/:id — clears subtree assignments, cascades. */
export const PATCH = route(async (req, ctx: Ctx) => {
  await requireActor();
  return ok(await updateProductLine((await ctx.params).id, await jsonBody<UpdateProductLineInput>(req)));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  await requireActor();
  return ok(await deleteProductLine((await ctx.params).id));
});
