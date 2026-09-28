import { ok } from '@/lib/envelope';
import { updateCompany } from '@/server/services/platform';
import { requireActor, requireAdmin, route } from '@/server/http';
import { jsonBodyWith, companyUpdateSchema } from '@/server/validate';

type Ctx = { params: Promise<{ id: string }> };

/* PATCH /api/v1/platform/companies/:id — update display fields (key immutable).
   Platform admin only. */
export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  requireAdmin(actor);
  return ok(await updateCompany(actor, (await ctx.params).id, await jsonBodyWith(req, companyUpdateSchema)));
});
