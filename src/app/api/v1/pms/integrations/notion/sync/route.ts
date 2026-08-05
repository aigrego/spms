import { ok } from '@/lib/envelope';
import { requirePerm } from '@/lib/permissions';
import { requireActor, route } from '@/server/http';
import { syncNotion } from '@/server/services/notionSync';

/* POST /api/v1/pms/integrations/notion/sync — 手动触发一次 Notion → SPMS 同步;
   以点击用户的 actor 执行(权限与活动日志复用现有逻辑)。返回
   { created, updated, skipped, errors }。
   ?full=1 全量重同步:忽略 lastSyncedAt 水位重拉全部页面(幂等,未变更页跳过),
   用于 issue 被直接删除后的重建。 */
export const POST = route(async (req) => {
  const actor = await requireActor();
  await requirePerm(actor, 'issues', 'write');
  const full = req.nextUrl.searchParams.get('full') === '1';
  return ok(await syncNotion(actor, { full }));
});
