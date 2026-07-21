import { ok } from '@/lib/envelope';
import {
  deleteTestCase,
  getTestCase,
  updateTestCase,
  type UpdateTestCaseInput,
} from '@/server/services/testcases';
import { jsonBody, requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ key: string }> };

/* GET    /api/v1/pms/test-cases/:key — detail; missing → data:null.
   PATCH  /api/v1/pms/test-cases/:key — partial update.
   DELETE /api/v1/pms/test-cases/:key — hard delete. */
export const GET = route(async (_req, ctx: Ctx) => {
  await requireActor();
  return ok(await getTestCase((await ctx.params).key));
});

export const PATCH = route(async (req, ctx: Ctx) => {
  await requireActor();
  return ok(await updateTestCase((await ctx.params).key, await jsonBody<UpdateTestCaseInput>(req)));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  await requireActor();
  return ok(await deleteTestCase((await ctx.params).key));
});
