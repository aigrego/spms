import { enterCompanyResponse, requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

/* POST /api/v1/platform/companies/:id/enter — re-sign the session cookie with
   `cid` pointing at this company. Same rule as /api/auth/switch-company:
   membership in the target company, or platform admin (no requireAdmin here —
   a member may enter their own company). */
export const POST = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return enterCompanyResponse(actor.userId, (await ctx.params).id);
});
