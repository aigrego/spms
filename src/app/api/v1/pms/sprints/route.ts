import { ok } from '@/lib/envelope';
import { createSprint, listSprints, type CreateSprintInput } from '@/server/services/sprints';
import { jsonBody, requireActor, route } from '@/server/http';

/* GET  /api/v1/pms/sprints?team — list (startDate asc).
   POST /api/v1/pms/sprints — create (name/startDate/endDate required). */
export const GET = route(async (req) => {
  await requireActor();
  return ok(await listSprints({ team: req.nextUrl.searchParams.get('team') ?? undefined }));
});

export const POST = route(async (req) => {
  await requireActor();
  return ok(await createSprint(await jsonBody<CreateSprintInput>(req)));
});
