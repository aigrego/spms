import { ok } from '@/lib/envelope';
import type { Matrix } from '@/lib/permissions';
import { getPermissionsMatrix, savePermissionsMatrix } from '@/server/services/platform';
import { jsonBody, requireActor, requireAdmin, route } from '@/server/http';

/* GET /api/v1/platform/permissions-matrix — the full 4 roles × 11 modules global
   matrix. PUT /api/v1/platform/permissions-matrix { matrix } — replace it (every
   cell validated, then upsert + cache bust). Platform admin only. */
export const GET = route(async () => {
  const actor = await requireActor();
  requireAdmin(actor);
  return ok(await getPermissionsMatrix(actor));
});

export const PUT = route(async (req) => {
  const actor = await requireActor();
  requireAdmin(actor);
  const body = await jsonBody<{ matrix: Matrix }>(req);
  return ok(await savePermissionsMatrix(actor, body.matrix));
});
