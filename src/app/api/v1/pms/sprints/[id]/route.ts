import { ok } from '@/lib/envelope';
import { deleteSprint, getSprint, updateSprint, type UpdateSprintInput } from '@/server/services/sprints';
import { jsonBody, requireActor, route } from '@/server/http';

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
  return ok(await updateSprint(actor, (await ctx.params).id, await jsonBody<UpdateSprintInput>(req)));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await deleteSprint(actor, (await ctx.params).id));
});
