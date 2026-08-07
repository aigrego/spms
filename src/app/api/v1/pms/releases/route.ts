import { ok } from '@/lib/envelope';
import { createRelease, listReleases } from '@/server/services/catalog';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, releaseCreateSchema } from '@/server/validate';

/* GET  /api/v1/pms/releases?product — list (position asc).
   POST /api/v1/pms/releases — create (auto RL-N key; targetDate as ISO string). */
export const GET = route(async (req) => {
  const actor = await requireActor();
  return ok(await listReleases(actor, { product: req.nextUrl.searchParams.get('product') ?? undefined }));
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  return ok(await createRelease(actor, await jsonBodyWith(req, releaseCreateSchema)));
});
