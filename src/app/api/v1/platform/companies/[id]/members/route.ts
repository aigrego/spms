import { ok } from '@/lib/envelope';
import { addMember, listMembers, type AddMemberInput } from '@/server/services/platform';
import { jsonBody, requireActor, requireAdmin, route } from '@/server/http';

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
  return ok(await addMember(actor, (await ctx.params).id, await jsonBody<AddMemberInput>(req)));
});
