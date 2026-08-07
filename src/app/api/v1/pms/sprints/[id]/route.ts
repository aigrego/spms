import { ok } from '@/lib/envelope';
import { deleteSprint, getSprint, updateSprint } from '@/server/services/sprints';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, sprintUpdateSchema } from '@/server/validate';

type Ctx = { params: Promise<{ id: string }> };

/* GET    /api/v1/pms/sprints/:id — meta + committed issues + stats; null when missing.
   PATCH  /api/v1/pms/sprints/:id — partial update.
   DELETE /api/v1/pms/sprints/:id — issues detach (sprintId → null), then delete. */
export const GET = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await getSprint(actor, (await ctx.params).id));
});

export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await updateSprint(actor, (await ctx.params).id, await jsonBodyWith(req, sprintUpdateSchema)));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await deleteSprint(actor, (await ctx.params).id));
});
