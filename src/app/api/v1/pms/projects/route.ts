import { ok } from '@/lib/envelope';
import { createProject, type CreateProjectInput } from '@/server/services/projects';
import { jsonBody, requireActor, route } from '@/server/http';

/* POST /api/v1/pms/projects — create. No route-level gate: the service's
   requireProjectAdmin allows company_admin OR platform admin (a route-level
   requireAdmin would wrongly block non-platform company_admins).
   The project list itself ships in /bootstrap — no GET here. */
export const POST = route(async (req) => {
  const actor = await requireActor();
  return ok(await createProject(actor, await jsonBody<CreateProjectInput>(req)));
});
