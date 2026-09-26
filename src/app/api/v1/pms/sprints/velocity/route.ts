import { ok } from '@/lib/envelope';
import { getVelocity } from '@/server/services/sprints';
import { requireActor, route } from '@/server/http';

/* GET /api/v1/pms/sprints/velocity — committed/completed points per
   sprint + avgVelocity (static segment wins over /sprints/[id]). */
export const GET = route(async () => {
  const actor = await requireActor();
  return ok(await getVelocity(actor));
});
