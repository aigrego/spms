import { ok } from '@/lib/envelope';
import { deleteProject, updateProject } from '@/server/services/projects';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, projectUpdateSchema } from '@/server/validate';

type Ctx = { params: Promise<{ id: string }> };

/* PATCH  /api/v1/pms/projects/:id — partial update (+lead double-write sync).
   DELETE /api/v1/pms/projects/:id — no route-level gate (see projects/route.ts);
   issues detach (set null). */
export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await updateProject(actor, (await ctx.params).id, await jsonBodyWith(req, projectUpdateSchema)));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await deleteProject(actor, (await ctx.params).id));
});
