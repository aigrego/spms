import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { notionConnections, projects } from '@/db/schema';
import { ApiException, ok } from '@/lib/envelope';
import { mergeStatusRules, SPMS_STATUSES, type NotionStatusRule } from '@/lib/notionStatusMap';
import { requirePerm } from '@/lib/permissions';
import { jsonBody, requireActor, route } from '@/server/http';
import { getDatabaseStatusOptions, notionConfigured, searchDatabases } from '@/server/notion';
import type { Actor } from '@/server/services/types';

type ConnectionRow = typeof notionConnections.$inferSelect;

/* The connection shape served to clients — accessToken is NEVER included. */
function toPublic(c: ConnectionRow) {
  return {
    workspaceId: c.workspaceId,
    workspaceName: c.workspaceName,
    databaseId: c.databaseId,
    databaseName: c.databaseName,
    projectId: c.projectId,
    statusMap: c.statusMap,
    lastSyncedAt: c.lastSyncedAt,
    createdAt: c.createdAt,
  };
}

async function connectionFor(actor: Actor): Promise<ConnectionRow | null> {
  const [c] = await db
    .select()
    .from(notionConnections)
    .where(eq(notionConnections.companyId, actor.companyId))
    .limit(1);
  return c ?? null;
}

/* GET /api/v1/pms/integrations/notion — connection status for the current
   company (no token). ?databases=1 additionally lists the databases the
   integration can access (Notion search API); a failing search (e.g. revoked
   token) degrades to databases:null + databasesError instead of failing the
   whole status payload. ?statuses=1 returns the effective status sync/mapping
   rules (数据库状态选项 ∪ 已存规则,未配置的按默认映射猜测、默认同步)。 */
export const GET = route(async (req) => {
  const actor = await requireActor();
  await requirePerm(actor, 'notion', 'read');
  const conn = await connectionFor(actor);
  const out: Record<string, unknown> = {
    configured: notionConfigured(),
    connection: conn ? toPublic(conn) : null,
  };
  if (req.nextUrl.searchParams.get('databases') === '1' && conn) {
    try {
      out.databases = await searchDatabases(conn.accessToken);
    } catch (e) {
      out.databases = null;
      out.databasesError = e instanceof Error ? e.message : String(e);
    }
  }
  if (req.nextUrl.searchParams.get('statuses') === '1' && conn) {
    if (!conn.databaseId) {
      out.statuses = null;
      out.statusesError = 'no-database';
    } else {
      try {
        const names = await getDatabaseStatusOptions(conn.accessToken, conn.databaseId);
        out.statuses = mergeStatusRules(names, conn.statusMap);
      } catch (e) {
        out.statuses = null;
        out.statusesError = e instanceof Error ? e.message : String(e);
      }
    }
  }
  return ok(out);
});

interface PatchBody {
  databaseId?: string | null;
  databaseName?: string | null;
  projectId?: string | null;
  statusMap?: NotionStatusRule[] | null;
}

/* 校验状态映射:每条 { name 非空, status ∈ issue 状态枚举 | null, sync 布尔 }。 */
function validateStatusMap(input: unknown): NotionStatusRule[] | null {
  if (input === null) return null;
  if (!Array.isArray(input)) throw new ApiException('VALIDATION_FAILED', 'statusMap 必须是数组');
  return input.map((r) => {
    const rule = r as Partial<NotionStatusRule>;
    if (typeof rule?.name !== 'string' || !rule.name.trim()) {
      throw new ApiException('VALIDATION_FAILED', 'statusMap 条目缺少 name');
    }
    if (rule.status !== null && !(SPMS_STATUSES as string[]).includes(rule.status ?? '')) {
      throw new ApiException('VALIDATION_FAILED', `statusMap 状态非法: ${rule.status}`);
    }
    return { name: rule.name.trim(), status: rule.status ?? null, sync: rule.sync !== false };
  });
}

/* PATCH /api/v1/pms/integrations/notion — save the sync database and/or the
   target project. Only the listed fields are updatable. */
export const PATCH = route(async (req) => {
  const actor = await requireActor();
  await requirePerm(actor, 'notion', 'write');
  const body = await jsonBody<PatchBody>(req);

  const set: Partial<ConnectionRow> = { updatedAt: new Date() };
  let touched = false;
  if (body.databaseId !== undefined) {
    set.databaseId = body.databaseId || null;
    set.databaseName = body.databaseId ? (body.databaseName ?? null) : null;
    touched = true;
  }
  if (body.projectId !== undefined) {
    const projectId = body.projectId || null;
    if (projectId) {
      const [p] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.companyId, actor.companyId)))
        .limit(1);
      if (!p) throw new ApiException('PROJECT_NOT_FOUND');
    }
    set.projectId = projectId;
    touched = true;
  }
  if (body.statusMap !== undefined) {
    set.statusMap = validateStatusMap(body.statusMap);
    touched = true;
  }
  if (!touched) throw new ApiException('VALIDATION_FAILED', '没有需要保存的字段');

  const conn = await connectionFor(actor);
  if (!conn) throw new ApiException('NOT_FOUND', '尚未连接 Notion');
  await db.update(notionConnections).set(set).where(eq(notionConnections.id, conn.id));
  const [updated] = await db.select().from(notionConnections).where(eq(notionConnections.id, conn.id)).limit(1);
  return ok({ configured: notionConfigured(), connection: updated ? toPublic(updated) : null });
});

/* DELETE /api/v1/pms/integrations/notion — 断开连接:删除连接行,其
   notion_issue_links 随 connectionId cascade 一并删除(重连后重新全量)。 */
export const DELETE = route(async () => {
  const actor = await requireActor();
  await requirePerm(actor, 'notion', 'write');
  const conn = await connectionFor(actor);
  if (!conn) throw new ApiException('NOT_FOUND', '尚未连接 Notion');
  await db.delete(notionConnections).where(eq(notionConnections.id, conn.id));
  return ok({ disconnected: true });
});
