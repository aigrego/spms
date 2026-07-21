import { ok } from '@/lib/envelope';
import { completeSprint } from '@/server/services/sprints';
import { requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

/* POST /api/v1/pms/sprints/:id/complete — active → completed; unfinished
   issues move back to the product backlog. Returns { sprint, movedCount }. */
export const POST = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await completeSprint(actor, (await ctx.params).id));
});
