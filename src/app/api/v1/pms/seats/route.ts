import { ok } from '@/lib/envelope';
import { listSeats } from '@/server/services/resources';
import { requireActor, route } from '@/server/http';

/* GET /api/v1/pms/seats — 当前公司的席位列表(memberships ⋈ users),
   研发资源页"内部成员"段的数据源。 */
export const GET = route(async () => {
  const actor = await requireActor();
  return ok(await listSeats(actor));
});
