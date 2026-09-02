import { ok } from '@/lib/envelope';
import { getCompanyMatrix, saveCompanyMatrix } from '@/server/services/platform';
import type { CompanyMatrix } from '@/lib/permissions';
import { jsonBody, requireActor, route } from '@/server/http';

/* GET /api/v1/pms/permissions-matrix — 本公司的有效矩阵(全局默认 + 本公司覆盖,
   4 角色 × 12 模块,含公司专属的 notion 模块)。
   PUT /api/v1/pms/permissions-matrix { matrix } — 整表替换本公司的覆盖矩阵。
   company_admin 或平台管理员。 */
export const GET = route(async () => {
  const actor = await requireActor();
  return ok(await getCompanyMatrix(actor, actor.companyId));
});

export const PUT = route(async (req) => {
  const actor = await requireActor();
  const body = await jsonBody<{ matrix?: CompanyMatrix }>(req);
  if (!body.matrix) throw new Error('缺少 matrix');
  return ok(await saveCompanyMatrix(actor, actor.companyId, body.matrix));
});
