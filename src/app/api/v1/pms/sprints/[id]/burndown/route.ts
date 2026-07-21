import { ok } from '@/lib/envelope';
import { getBurndown } from '@/server/services/sprints';
import { requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

/* GET /api/v1/pms/sprints/:id/burndown — ideal (linear) vs. snapshot actual;
   null when the sprint is missing. */
export const GET = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await getBurndown(actor, (await ctx.params).id));
});
