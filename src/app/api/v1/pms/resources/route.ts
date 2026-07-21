import { ok } from '@/lib/envelope';
import { listMembers } from '@/server/services/resources';
import { requireActor, route } from '@/server/http';

/* GET /api/v1/pms/resources — the whole resource pool (humans + agents,
   type/name ordered). */
export const GET = route(async () => {
  const actor = await requireActor();
  return ok(await listMembers(actor));
});
