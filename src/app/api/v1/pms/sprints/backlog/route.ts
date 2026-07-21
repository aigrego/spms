import { ok } from '@/lib/envelope';
import { getBacklog } from '@/server/services/sprints';
import { requireActor, route } from '@/server/http';

/* GET /api/v1/pms/sprints/backlog?team — issues not committed to any sprint
   (static segment wins over /sprints/[id]). */
export const GET = route(async (req) => {
  await requireActor();
  return ok(await getBacklog({ team: req.nextUrl.searchParams.get('team') ?? undefined }));
});
