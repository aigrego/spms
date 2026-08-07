import { ok } from '@/lib/envelope';
import { deleteIssue, getIssue, updateIssue } from '@/server/services/issues';
import { requireActor, route } from '@/server/http';
import { issueUpdateSchema, jsonBodyWith } from '@/server/validate';

type Ctx = { params: Promise<{ key: string }> };

/* GET    /api/v1/pms/issues/:key — detail (+activities); missing → data:null.
   PATCH  /api/v1/pms/issues/:key — partial update (labels full-replace).
   DELETE /api/v1/pms/issues/:key — hard delete. */
export const GET = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await getIssue(actor, (await ctx.params).key));
});

export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await updateIssue(actor, (await ctx.params).key, await jsonBodyWith(req, issueUpdateSchema)));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await deleteIssue(actor, (await ctx.params).key));
});
