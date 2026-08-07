import { ok } from '@/lib/envelope';
import { deleteTestCase, getTestCase, updateTestCase } from '@/server/services/testcases';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, testCaseUpdateSchema } from '@/server/validate';

type Ctx = { params: Promise<{ key: string }> };

/* GET    /api/v1/pms/test-cases/:key — detail; missing → data:null.
   PATCH  /api/v1/pms/test-cases/:key — partial update.
   DELETE /api/v1/pms/test-cases/:key — hard delete. */
export const GET = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await getTestCase(actor, (await ctx.params).key));
});

export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await updateTestCase(actor, (await ctx.params).key, await jsonBodyWith(req, testCaseUpdateSchema)));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await deleteTestCase(actor, (await ctx.params).key));
});
