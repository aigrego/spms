import { ok } from '@/lib/envelope';
import { createProductLine, listProductLines, type CreateProductLineInput } from '@/server/services/catalog';
import { jsonBody, requireActor, route } from '@/server/http';

/* GET  /api/v1/pms/product-lines — list (position asc).
   POST /api/v1/pms/product-lines — create (auto PL-N key). */
export const GET = route(async () => {
  await requireActor();
  return ok(await listProductLines());
});

export const POST = route(async (req) => {
  await requireActor();
  return ok(await createProductLine(await jsonBody<CreateProductLineInput>(req)));
});
