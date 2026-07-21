import { ok } from '@/lib/envelope';
import { deleteIssue, getIssue, updateIssue, type UpdateIssueInput } from '@/server/services/issues';
import { jsonBody, requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ key: string }> };

/* GET    /api/v1/pms/issues/:key — detail (+activities); missing → data:null.
   PATCH  /api/v1/pms/issues/:key — partial update (labels full-replace).
   DELETE /api/v1/pms/issues/:key — hard delete. */
export const GET = route(async (_req, ctx: Ctx) => {
  await requireActor();
  return ok(await getIssue((await ctx.params).key));
});

export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await updateIssue(actor, (await ctx.params).key, await jsonBody<UpdateIssueInput>(req)));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  await requireActor();
  return ok(await deleteIssue((await ctx.params).key));
});
