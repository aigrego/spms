import { ok } from '@/lib/envelope';
import { listCompanyAttachments } from '@/server/services/attachments';
import { requireActor, route } from '@/server/http';

/* GET /api/v1/pms/attachments — 本公司全部附件（设置 → 附件 面板），
   公司隔离与模块读权限闸门在 listCompanyAttachments 内。 */
export const GET = route(async () => {
  const actor = await requireActor();
  return ok(await listCompanyAttachments(actor));
});
