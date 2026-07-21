import { ok } from '@/lib/envelope';
import { getVelocity } from '@/server/services/sprints';
import { requireActor, route } from '@/server/http';

/* GET /api/v1/pms/sprints/velocity?team — committed/completed points per
   sprint + avgVelocity (static segment wins over /sprints/[id]). */
export const GET = route(async (req) => {
  const actor = await requireActor();
  return ok(await getVelocity(actor, { team: req.nextUrl.searchParams.get('team') ?? undefined }));
});
