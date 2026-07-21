import { ok } from '@/lib/envelope';
import { createProduct, listProducts, type CreateProductInput } from '@/server/services/catalog';
import { jsonBody, requireActor, route } from '@/server/http';

/* GET  /api/v1/pms/products?line — list (position asc).
   POST /api/v1/pms/products — create (auto PD-N key; leadId double-write). */
export const GET = route(async (req) => {
  const actor = await requireActor();
  return ok(await listProducts(actor, { line: req.nextUrl.searchParams.get('line') ?? undefined }));
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  return ok(await createProduct(actor, await jsonBody<CreateProductInput>(req)));
});
