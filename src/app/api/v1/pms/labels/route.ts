import { ok } from '@/lib/envelope';
import { create } from '@/server/services/labels';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, labelCreateSchema } from '@/server/validate';

/* POST /api/v1/pms/labels — 现场自定义标签（BUG-17）。标签列表随 bootstrap
   下发，不单列 GET。 */
export const POST = route(async (req) => {
  const actor = await requireActor();
  return ok(await create(actor, await jsonBodyWith(req, labelCreateSchema)));
});
