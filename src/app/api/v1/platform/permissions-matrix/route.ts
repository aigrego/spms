import { ok } from '@/lib/envelope';
import type { Matrix } from '@/lib/permissions';
import { getPermissionsMatrix, savePermissionsMatrix } from '@/server/services/platform';
import { requireActor, requireAdmin, route } from '@/server/http';
import { jsonBodyWith, permissionsMatrixSchema } from '@/server/validate';

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
  const body = await jsonBodyWith(req, permissionsMatrixSchema);
  // 矩阵完整性(角色 × 模块全覆盖、档位合法)由 service 的 validateMatrix 校验。
  return ok(await savePermissionsMatrix(actor, body.matrix as Matrix));
});
