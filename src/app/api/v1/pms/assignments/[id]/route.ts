import { ok } from '@/lib/envelope';
import { updateRole } from '@/server/services/assignments';
import { jsonBody, requireActor, route } from '@/server/http';
import { asRole } from '@/server/params';

type Ctx = { params: Promise<{ id: string }> };

/* PATCH /api/v1/pms/assignments/:id { role } — change an assignment's role
   (lead/member). */
export const PATCH = route(async (req, ctx: Ctx) => {
  await requireActor();
  const body = await jsonBody<{ role?: string }>(req);
  return ok(await updateRole((await ctx.params).id, asRole(body.role)));
});
