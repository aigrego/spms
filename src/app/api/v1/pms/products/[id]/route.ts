import { ok } from '@/lib/envelope';
import { deleteProduct, updateProduct } from '@/server/services/catalog';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, productUpdateSchema } from '@/server/validate';

type Ctx = { params: Promise<{ id: string }> };

/* PATCH  /api/v1/pms/products/:id — partial update (+lead double-write).
   DELETE /api/v1/pms/products/:id — clears subtree assignments, cascades. */
export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await updateProduct(actor, (await ctx.params).id, await jsonBodyWith(req, productUpdateSchema)));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await deleteProduct(actor, (await ctx.params).id));
});
