import { ok } from '@/lib/envelope';
import { deletePlan, getPlan, updatePlan } from '@/server/services/plans';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, planUpdateSchema } from '@/server/validate';

type Ctx = { params: Promise<{ key: string }> };

/* GET    /api/v1/pms/plans/:key — detail; missing → data:null.
   PATCH  /api/v1/pms/plans/:key — partial update (requirementIds = 全量替换).
   DELETE /api/v1/pms/plans/:key — hard delete. */
export const GET = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await getPlan(actor, (await ctx.params).key));
});

export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await updatePlan(actor, (await ctx.params).key, await jsonBodyWith(req, planUpdateSchema)));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await deletePlan(actor, (await ctx.params).key));
});
