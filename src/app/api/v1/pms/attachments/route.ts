import { ok } from '@/lib/envelope';
import { listCompanyAttachments } from '@/server/services/attachments';
import { requireActor, route } from '@/server/http';

/* GET /api/v1/pms/attachments — 本公司附件分页列表（设置 → 附件 面板），
   ?page=(从 1 起)&pageSize=(默认 24,上限 100)，公司隔离与模块读权限闸门在
   listCompanyAttachments 内。 */
export const GET = route(async (req) => {
  const actor = await requireActor();
  const sp = req.nextUrl.searchParams;
  return ok(
    await listCompanyAttachments(actor, {
      page: Number(sp.get('page')) || undefined,
      pageSize: Number(sp.get('pageSize')) || undefined,
    }),
  );
});
