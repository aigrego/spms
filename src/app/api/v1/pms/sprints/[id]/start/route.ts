import { ok } from '@/lib/envelope';
import { startSprint } from '@/server/services/sprints';
import { requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

/* POST /api/v1/pms/sprints/:id/start — planned → active; at most one active
   sprint per project (CONFLICT otherwise). */
export const POST = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await startSprint(actor, (await ctx.params).id));
});
