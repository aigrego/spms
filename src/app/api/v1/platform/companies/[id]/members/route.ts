import { ok } from '@/lib/envelope';
import { addMember, listMembers } from '@/server/services/platform';
import { requireActor, requireAdmin, route } from '@/server/http';
import { jsonBodyWith, memberAddSchema } from '@/server/validate';

type Ctx = { params: Promise<{ id: string }> };

/* GET  /api/v1/platform/companies/:id/members — memberships + user rows.
   POST /api/v1/platform/companies/:id/members — add a user (created on the fly
   when the username is new; password then required). Platform admin only. */
export const GET = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  requireAdmin(actor);
  return ok(await listMembers(actor, (await ctx.params).id));
});

export const POST = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  requireAdmin(actor);
  return ok(await addMember(actor, (await ctx.params).id, await jsonBodyWith(req, memberAddSchema)));
});
