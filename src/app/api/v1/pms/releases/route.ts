import { ok } from '@/lib/envelope';
import { createRelease, listReleases, type CreateReleaseInput } from '@/server/services/catalog';
import { jsonBody, requireActor, route } from '@/server/http';

/* GET  /api/v1/pms/releases?product — list (position asc).
   POST /api/v1/pms/releases — create (auto RL-N key; targetDate as ISO string). */
export const GET = route(async (req) => {
  const actor = await requireActor();
  return ok(await listReleases(actor, { product: req.nextUrl.searchParams.get('product') ?? undefined }));
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  return ok(await createRelease(actor, await jsonBody<CreateReleaseInput>(req)));
});
