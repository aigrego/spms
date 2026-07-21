import { ok } from '@/lib/envelope';
import { createProject, type CreateProjectInput } from '@/server/services/projects';
import { jsonBody, requireActor, requireAdmin, route } from '@/server/http';

/* POST /api/v1/pms/projects — create. ADMIN ONLY (403 FORBIDDEN otherwise).
   The project list itself ships in /bootstrap — no GET here. */
export const POST = route(async (req) => {
  const actor = await requireActor();
  requireAdmin(actor);
  return ok(await createProject(actor, await jsonBody<CreateProjectInput>(req)));
});
