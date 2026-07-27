import { ok } from '@/lib/envelope';
import { archiveProject } from '@/server/services/projects';
import { jsonBody, requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

/* POST /api/v1/pms/projects/:id/archive { archived: boolean } — 归档/取消归档
   (company_admin/平台管理员)。归档项目的全部 issue 从「全部 Issues」/
   产品待办隐藏(等效批量归档);项目卡片默认隐藏。 */
export const POST = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  const body = await jsonBody<{ archived?: boolean }>(req);
  return ok(await archiveProject(actor, (await ctx.params).id, body.archived !== false));
});
