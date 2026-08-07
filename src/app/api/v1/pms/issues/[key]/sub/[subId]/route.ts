import { ok } from '@/lib/envelope';
import { toggleSubIssue } from '@/server/services/issues';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, subIssueToggleSchema } from '@/server/validate';

type Ctx = { params: Promise<{ key: string; subId: string }> };

/* PATCH /api/v1/pms/issues/:key/sub/:subId { status } — toggle a sub-issue. */
export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  const { key, subId } = await ctx.params;
  const { status } = await jsonBodyWith(req, subIssueToggleSchema);
  return ok(await toggleSubIssue(actor, key, subId, status));
});
