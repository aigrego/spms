import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { notionConnections } from '@/db/schema';
import { ApiException, ok } from '@/lib/envelope';
import { requirePerm } from '@/lib/permissions';
import { requireActor, route } from '@/server/http';
import { queryDatabaseFirstPage } from '@/server/notion';

/* GET /api/v1/pms/integrations/notion/preview — 阶段 1 调试接口:拉取所选
   数据库最近编辑的一条记录,返回原始 Notion page JSON,用于核对字段映射。 */
export const GET = route(async () => {
  const actor = await requireActor();
  await requirePerm(actor, 'issues', 'write');
  const [conn] = await db
    .select()
    .from(notionConnections)
    .where(eq(notionConnections.companyId, actor.companyId))
    .limit(1);
  if (!conn) throw new ApiException('NOT_FOUND', '尚未连接 Notion');
  if (!conn.databaseId) throw new ApiException('VALIDATION_FAILED', '请先选择要同步的数据库');

  let page: unknown | null;
  try {
    page = await queryDatabaseFirstPage(conn.accessToken, conn.databaseId);
  } catch (e) {
    throw new ApiException('INTERNAL', e instanceof Error ? e.message : String(e));
  }
  if (!page) throw new ApiException('NOT_FOUND', '该数据库没有记录');
  return ok({ page });
});
