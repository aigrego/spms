import { ok } from '@/lib/envelope';
import { createCompany, listCompanies } from '@/server/services/platform';
import { requireActor, requireAdmin, route } from '@/server/http';
import { jsonBodyWith, companyCreateSchema } from '@/server/validate';

/* GET  /api/v1/platform/companies — all companies + membership counts.
   POST /api/v1/platform/companies — create (creator becomes its company_admin).
   Platform admin only: requireAdmin fails fast, the service re-checks. */
export const GET = route(async () => {
  const actor = await requireActor();
  requireAdmin(actor);
  return ok(await listCompanies(actor));
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  requireAdmin(actor);
  return ok(await createCompany(actor, await jsonBodyWith(req, companyCreateSchema)));
});
