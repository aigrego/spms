import { ok } from '@/lib/envelope';
import { createCompany, listCompanies, type CreateCompanyInput } from '@/server/services/platform';
import { jsonBody, requireActor, requireAdmin, route } from '@/server/http';

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
  return ok(await createCompany(actor, await jsonBody<CreateCompanyInput>(req)));
});
