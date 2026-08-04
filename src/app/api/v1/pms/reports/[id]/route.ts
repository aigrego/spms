import { ok } from '@/lib/envelope';
import { deleteReport } from '@/server/services/reports';
import { requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

/* DELETE /api/v1/pms/reports/:id — 删除日报(本人;他人需 company_admin/平台管理员)。 */
export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await deleteReport(actor, (await ctx.params).id));
});
