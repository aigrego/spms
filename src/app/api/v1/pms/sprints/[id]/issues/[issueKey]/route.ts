import { ok } from '@/lib/envelope';
import { moveIssue } from '@/server/services/sprints';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, sprintMoveIssueSchema } from '@/server/validate';

type Ctx = { params: Promise<{ id: string; issueKey: string }> };

/* PATCH /api/v1/pms/sprints/:id/issues/:issueKey — move an issue into / out of
   a sprint (`:id` may be `_backlog`); moving in forces projectId = sprint's. */
export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  const { id, issueKey } = await ctx.params;
  const { storyPoints } = await jsonBodyWith(req, sprintMoveIssueSchema);
  return ok(await moveIssue(actor, id, issueKey, storyPoints));
});
