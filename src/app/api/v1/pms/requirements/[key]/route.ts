import { ok } from '@/lib/envelope';
import {
  deleteRequirement,
  getRequirement,
  updateRequirement,
  type UpdateRequirementInput,
} from '@/server/services/requirements';
import { jsonBody, requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ key: string }> };

/* GET    /api/v1/pms/requirements/:key — detail; missing → data:null.
   PATCH  /api/v1/pms/requirements/:key — partial update.
   DELETE /api/v1/pms/requirements/:key — hard delete (refs set null). */
export const GET = route(async (_req, ctx: Ctx) => {
  await requireActor();
  return ok(await getRequirement((await ctx.params).key));
});

export const PATCH = route(async (req, ctx: Ctx) => {
  await requireActor();
  return ok(await updateRequirement((await ctx.params).key, await jsonBody<UpdateRequirementInput>(req)));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  await requireActor();
  return ok(await deleteRequirement((await ctx.params).key));
});
