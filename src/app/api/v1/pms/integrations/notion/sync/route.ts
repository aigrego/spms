import { ok } from '@/lib/envelope';
import { requirePerm } from '@/lib/permissions';
import { requireActor, route } from '@/server/http';
import { syncNotion } from '@/server/services/notionSync';

/* POST /api/v1/pms/integrations/notion/sync — 手动触发一次 Notion → SPMS 同步;
   以点击用户的 actor 执行(权限与活动日志复用现有逻辑)。返回
   { created, updated, skipped, errors }。 */
export const POST = route(async () => {
  const actor = await requireActor();
  await requirePerm(actor, 'issues', 'write');
  return ok(await syncNotion(actor));
});
