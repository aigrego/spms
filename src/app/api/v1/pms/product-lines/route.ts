import { ok } from '@/lib/envelope';
import { createProductLine, listProductLines } from '@/server/services/catalog';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, productLineCreateSchema } from '@/server/validate';

/* GET  /api/v1/pms/product-lines — list (position asc).
   POST /api/v1/pms/product-lines — create (auto PL-N key). */
export const GET = route(async () => {
  const actor = await requireActor();
  return ok(await listProductLines(actor));
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  return ok(await createProductLine(actor, await jsonBodyWith(req, productLineCreateSchema)));
});
