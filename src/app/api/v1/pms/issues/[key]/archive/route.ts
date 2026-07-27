import { ok } from '@/lib/envelope';
import { archiveIssue } from '@/server/services/issues';
import { jsonBody, requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ key: string }> };

/* POST /api/v1/pms/issues/:key/archive { archived: boolean } — 归档/取消归档。
   归档只影响可见性(全部 Issues/产品待办默认隐藏),不做只读约束。 */
export const POST = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  const body = await jsonBody<{ archived?: boolean }>(req);
  return ok(await archiveIssue(actor, (await ctx.params).key, body.archived !== false));
});
