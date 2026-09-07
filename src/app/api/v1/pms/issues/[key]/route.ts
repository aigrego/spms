import { ok } from '@/lib/envelope';
import { deleteIssue, getIssue } from '@/server/services/issues';
import { updateIssueWithWorkflow } from '@/mcp/workflow';
import { requireActor, route } from '@/server/http';
import { issueUpdateSchema, jsonBodyWith } from '@/server/validate';

type Ctx = { params: Promise<{ key: string }> };

/* GET    /api/v1/pms/issues/:key — detail (+activities); missing → data:null.
   PATCH  /api/v1/pms/issues/:key — partial update (labels full-replace)。
          与 MCP 同口径走工作流:done 先落 testing 并指派测试人员;testing → done
          过测试关单门禁(关联用例未全过报 TESTS_NOT_PASSED,force=true 覆盖)。
   DELETE /api/v1/pms/issues/:key — hard delete. */
export const GET = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await getIssue(actor, (await ctx.params).key));
});

export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await updateIssueWithWorkflow(actor, (await ctx.params).key, await jsonBodyWith(req, issueUpdateSchema)));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await deleteIssue(actor, (await ctx.params).key));
});
