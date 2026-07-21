import { ok } from '@/lib/envelope';
import { removeSeat, updateSeatRole } from '@/server/services/resources';
import type { CompanyRole } from '@/server/services/platform';
import { jsonBody, requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

/* PATCH  /api/v1/pms/seats/:id { role } — 改席位的公司角色(company_admin 写)。
   DELETE /api/v1/pms/seats/:id        — 回收席位(company_admin 写)。 */
export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  const body = await jsonBody<{ role?: CompanyRole }>(req);
  return ok(await updateSeatRole(actor, (await ctx.params).id, body.role as CompanyRole));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await removeSeat(actor, (await ctx.params).id));
});
