import { ok } from '@/lib/envelope';
import { moveIssue } from '@/server/services/sprints';
import { jsonBody, requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string; issueKey: string }> };

/* PATCH /api/v1/pms/sprints/:id/issues/:issueKey — move an issue into / out of
   a sprint (`:id` may be `_backlog`); moving in forces projectId = sprint's. */
export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  const { id, issueKey } = await ctx.params;
  const body = await jsonBody<{ storyPoints?: number | null }>(req);
  return ok(await moveIssue(actor, id, issueKey, body.storyPoints));
});
