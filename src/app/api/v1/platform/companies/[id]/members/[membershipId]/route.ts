import { ok } from '@/lib/envelope';
import { removeMember, updateMemberRole, type CompanyRole } from '@/server/services/platform';
import { jsonBody, requireActor, requireAdmin, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string; membershipId: string }> };

/* PATCH  /api/v1/platform/companies/:id/members/:membershipId — change company role.
   DELETE /api/v1/platform/companies/:id/members/:membershipId — remove the
   membership (the user account survives). Platform admin only. */
export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  requireAdmin(actor);
  const { id, membershipId } = await ctx.params;
  const body = await jsonBody<{ role: CompanyRole }>(req);
  return ok(await updateMemberRole(actor, id, membershipId, body.role));
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  requireAdmin(actor);
  const { id, membershipId } = await ctx.params;
  return ok(await removeMember(actor, id, membershipId));
});
