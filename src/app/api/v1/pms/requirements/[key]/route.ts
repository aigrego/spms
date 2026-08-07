import { ok } from '@/lib/envelope';
import { deleteRequirement, getRequirement, updateRequirement } from '@/server/services/requirements';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, requirementUpdateSchema } from '@/server/validate';

type Ctx = { params: Promise<{ key: string }> };

/* GET    /api/v1/pms/requirements/:key — detail; missing → data:null.
   PATCH  /api/v1/pms/requirements/:key — partial update.
   DELETE /api/v1/pms/requirements/:key — hard delete (refs set null). */
export const GET = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await getRequirement(actor, (await ctx.params).key));
});

export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await updateRequirement(actor, (await ctx.params).key, await jsonBodyWith(req, requirementUpdateSchema)));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await deleteRequirement(actor, (await ctx.params).key));
});
