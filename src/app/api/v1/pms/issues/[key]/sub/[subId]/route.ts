import { ok, ApiException } from '@/lib/envelope';
import { toggleSubIssue, type IssueStatus } from '@/server/services/issues';
import { jsonBody, requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ key: string; subId: string }> };

const STATUSES: readonly IssueStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'];

/* PATCH /api/v1/pms/issues/:key/sub/:subId { status } — toggle a sub-issue. */
export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  const { key, subId } = await ctx.params;
  const body = await jsonBody<{ status?: IssueStatus }>(req);
  if (!body.status || !STATUSES.includes(body.status)) {
    throw new ApiException('VALIDATION_FAILED', 'status 不合法');
  }
  return ok(await toggleSubIssue(actor, key, subId, body.status));
});
