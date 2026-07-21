import { ok } from '@/lib/envelope';
import { bootstrap } from '@/server/services/meta';
import { requireActor, route } from '@/server/http';

/* GET /api/v1/pms/bootstrap — start-up reference data (me/members/projects/...). */
export const GET = route(async () => {
  const actor = await requireActor();
  return ok(await bootstrap(actor));
});
