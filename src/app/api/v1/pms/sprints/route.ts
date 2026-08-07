import { ok } from '@/lib/envelope';
import { createSprint, listSprints } from '@/server/services/sprints';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, sprintCreateSchema } from '@/server/validate';

/* GET  /api/v1/pms/sprints?team — list (startDate asc).
   POST /api/v1/pms/sprints — create (name/startDate/endDate required). */
export const GET = route(async (req) => {
  const actor = await requireActor();
  return ok(await listSprints(actor, { team: req.nextUrl.searchParams.get('team') ?? undefined }));
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  return ok(await createSprint(actor, await jsonBodyWith(req, sprintCreateSchema)));
});
