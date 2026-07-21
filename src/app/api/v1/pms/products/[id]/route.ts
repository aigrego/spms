import { ok } from '@/lib/envelope';
import { deleteProduct, updateProduct, type UpdateProductInput } from '@/server/services/catalog';
import { jsonBody, requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

/* PATCH  /api/v1/pms/products/:id — partial update (+lead double-write).
   DELETE /api/v1/pms/products/:id — clears subtree assignments, cascades. */
export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await updateProduct(actor, (await ctx.params).id, await jsonBody<UpdateProductInput>(req)));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  await requireActor();
  return ok(await deleteProduct((await ctx.params).id));
});
