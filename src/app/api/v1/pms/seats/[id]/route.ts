import { ok } from '@/lib/envelope';
import { removeSeat, updateSeatRole } from '@/server/services/resources';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, roleUpdateSchema } from '@/server/validate';

type Ctx = { params: Promise<{ id: string }> };

/* PATCH  /api/v1/pms/seats/:id { role } — 改席位的公司角色(company_admin 写)。
   DELETE /api/v1/pms/seats/:id        — 回收席位(company_admin 写)。 */
export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  const body = await jsonBodyWith(req, roleUpdateSchema);
  return ok(await updateSeatRole(actor, (await ctx.params).id, body.role));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await removeSeat(actor, (await ctx.params).id));
});
