import { ok } from '@/lib/envelope';
import { jsonBody, requireActor, route } from '@/server/http';
import {
  disconnectNotion,
  getNotionIntegration,
  updateNotionConnection,
  type UpdateNotionConnectionInput,
} from '@/server/services/notionSync';

/* /api/v1/pms/integrations/notion — 本公司的 Notion 连接管理（连接状态 /
   保存同步数据库·目标项目·状态映射 / 断开）。薄路由：业务逻辑见
   @/server/services/notionSync 的连接管理部分；accessToken 永不回显。 */

/* GET — connection status for the current company (no token).
   ?databases=1 additionally lists the databases the integration can access
   (Notion search API); a failing search degrades to databases:null +
   databasesError instead of failing the whole status payload.
   ?statuses=1 returns the effective status sync/mapping rules. */
export const GET = route(async (req) =>
  ok(
    await getNotionIntegration(await requireActor(), {
      databases: req.nextUrl.searchParams.get('databases') === '1',
      statuses: req.nextUrl.searchParams.get('statuses') === '1',
    }),
  ),
);

/* PATCH — save the sync database and/or the target project. */
export const PATCH = route(async (req) =>
  ok(await updateNotionConnection(await requireActor(), await jsonBody<UpdateNotionConnectionInput>(req))),
);

/* DELETE — 断开连接（notion_issue_links 随 connectionId cascade 一并删除）。 */
export const DELETE = route(async () => ok(await disconnectNotion(await requireActor())));
