import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { dailyReportEntries, dailyReports, members, projects } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { requirePerm } from '@/lib/permissions';
import type { Actor } from './types';

/* Daily report service (日报模块).

   每人每天一份日报,内容按项目拆成 entries —— 汇总视图按 项目 → 人员 → 任务
   上卷,供负责人统一上报。日期是客户端本地时区的 'YYYY-MM-DD' 日历日,服务端
   把它当作不透明的 day key,绝不自行推导「今天」(避免 UTC 偏移 bug)。

   模块门:'reports'。read = 查看全公司日报(团队内公开);write = 提交/编辑自己的
   日报;删除他人日报需 company_admin / 平台管理员。 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CONTENT_LEN = 4000;
const LIST_LIMIT = 500;

function assertDay(date: string): void {
  if (!DAY_RE.test(date)) throw new ApiException('VALIDATION_FAILED', '日期格式应为 YYYY-MM-DD');
}

export interface ReportEntryInput {
  projectId: string;
  content: string;
}

export interface ReportEntryView {
  id: string;
  projectId: string;
  content: string;
  position: number;
}

export interface ReportView {
  id: string;
  memberId: string;
  date: string;
  entries: ReportEntryView[];
  createdAt: Date;
  updatedAt: Date;
}

function groupEntries(
  reportRows: (typeof dailyReports.$inferSelect)[],
  entryRows: (typeof dailyReportEntries.$inferSelect)[],
): ReportView[] {
  const byReport = new Map<string, ReportEntryView[]>();
  for (const e of entryRows) {
    const list = byReport.get(e.reportId) ?? [];
    list.push({ id: e.id, projectId: e.projectId, content: e.content, position: e.position });
    byReport.set(e.reportId, list);
  }
  return reportRows.map((r) => ({
    id: r.id,
    memberId: r.memberId,
    date: r.date,
    entries: (byReport.get(r.id) ?? []).sort((a, b) => a.position - b.position),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

/* ---- list (汇总视图数据源) ---- */
export interface ListReportsFilter {
  startDate?: string;
  endDate?: string;
  memberId?: string;
  projectId?: string;
}

export async function listReports(actor: Actor, filter: ListReportsFilter = {}): Promise<ReportView[]> {
  await requirePerm(actor, 'reports', 'read');
  const conds = [eq(dailyReports.companyId, actor.companyId)];
  if (filter.startDate) {
    assertDay(filter.startDate);
    conds.push(gte(dailyReports.date, filter.startDate));
  }
  if (filter.endDate) {
    assertDay(filter.endDate);
    conds.push(lte(dailyReports.date, filter.endDate));
  }
  if (filter.memberId) conds.push(eq(dailyReports.memberId, filter.memberId));
  if (filter.projectId) {
    const hits = await db
      .select({ reportId: dailyReportEntries.reportId })
      .from(dailyReportEntries)
      .where(and(eq(dailyReportEntries.companyId, actor.companyId), eq(dailyReportEntries.projectId, filter.projectId)));
    if (hits.length === 0) return [];
    conds.push(inArray(dailyReports.id, hits.map((h) => h.reportId)));
  }
  const reportRows = await db
    .select()
    .from(dailyReports)
    .where(and(...conds))
    .orderBy(desc(dailyReports.date), desc(dailyReports.createdAt))
    .limit(LIST_LIMIT);
  if (reportRows.length === 0) return [];
  const entryRows = await db
    .select()
    .from(dailyReportEntries)
    .where(inArray(dailyReportEntries.reportId, reportRows.map((r) => r.id)));
  return groupEntries(reportRows, entryRows);
}

/* ---- my report for a day (写日报页数据源) ---- */
export async function getMyReport(actor: Actor, date: string): Promise<ReportView | null> {
  await requirePerm(actor, 'reports', 'read');
  assertDay(date);
  if (!actor.memberId) return null; // 无席位的平台管理员没有 member 投影
  const [r] = await db
    .select()
    .from(dailyReports)
    .where(
      and(
        eq(dailyReports.companyId, actor.companyId),
        eq(dailyReports.memberId, actor.memberId),
        eq(dailyReports.date, date),
      ),
    )
    .limit(1);
  if (!r) return null;
  const entryRows = await db.select().from(dailyReportEntries).where(eq(dailyReportEntries.reportId, r.id));
  return groupEntries([r], entryRows)[0];
}

/* ---- upsert my report (覆盖提交:同日重复提交 = 全量替换 entries) ---- */
export async function upsertMyReport(
  actor: Actor,
  input: { date: string; entries: ReportEntryInput[] },
): Promise<ReportView> {
  await requirePerm(actor, 'reports', 'write');
  if (!actor.memberId) throw new ApiException('FORBIDDEN', '需要公司席位才能提交日报', 403);
  assertDay(input.date);
  if (!Array.isArray(input.entries)) throw new ApiException('VALIDATION_FAILED', '缺少日报内容');

  // 清洗:去掉空内容块、按项目去重、限制长度。
  const seen = new Set<string>();
  const entries: ReportEntryInput[] = [];
  for (const e of input.entries) {
    const content = (e?.content ?? '').trim();
    if (!content) continue;
    if (typeof e.projectId !== 'string' || !e.projectId) throw new ApiException('VALIDATION_FAILED', '缺少项目');
    if (content.length > MAX_CONTENT_LEN) {
      throw new ApiException('VALIDATION_FAILED', `单项目内容不能超过 ${MAX_CONTENT_LEN} 字`);
    }
    if (seen.has(e.projectId)) throw new ApiException('VALIDATION_FAILED', '同一项目只能填写一段内容');
    seen.add(e.projectId);
    entries.push({ projectId: e.projectId, content });
  }
  if (entries.length === 0) throw new ApiException('VALIDATION_FAILED', '至少填写一个项目的内容');

  // 项目必须属于本公司且未归档。
  const projRows = await db
    .select({ id: projects.id, archivedAt: projects.archivedAt })
    .from(projects)
    .where(
      and(
        eq(projects.companyId, actor.companyId),
        inArray(projects.id, entries.map((e) => e.projectId)),
      ),
    );
  const writableIds = new Set(projRows.filter((p) => !p.archivedAt).map((p) => p.id));
  for (const e of entries) {
    if (!writableIds.has(e.projectId)) throw new ApiException('PROJECT_NOT_FOUND');
  }

  const reportId = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: dailyReports.id })
      .from(dailyReports)
      .where(
        and(
          eq(dailyReports.companyId, actor.companyId),
          eq(dailyReports.memberId, actor.memberId!),
          eq(dailyReports.date, input.date),
        ),
      )
      .limit(1);
    let id: string;
    if (existing) {
      id = existing.id;
      await tx.update(dailyReports).set({ updatedAt: new Date() }).where(eq(dailyReports.id, id));
      await tx.delete(dailyReportEntries).where(eq(dailyReportEntries.reportId, id));
    } else {
      id = crypto.randomUUID();
      await tx
        .insert(dailyReports)
        .values({ id, companyId: actor.companyId, memberId: actor.memberId!, date: input.date });
    }
    await tx.insert(dailyReportEntries).values(
      entries.map((e, i) => ({
        id: crypto.randomUUID(),
        reportId: id,
        companyId: actor.companyId,
        projectId: e.projectId,
        content: e.content,
        position: i,
      })),
    );
    return id;
  });

  const [r] = await db.select().from(dailyReports).where(eq(dailyReports.id, reportId)).limit(1);
  const entryRows = await db.select().from(dailyReportEntries).where(eq(dailyReportEntries.reportId, reportId));
  return groupEntries([r], entryRows)[0];
}

/* ---- delete (本人;他人日报需 company_admin / 平台管理员) ---- */
export async function deleteReport(actor: Actor, id: string): Promise<{ id: string }> {
  await requirePerm(actor, 'reports', 'write');
  const [r] = await db
    .select()
    .from(dailyReports)
    .where(and(eq(dailyReports.companyId, actor.companyId), eq(dailyReports.id, id)))
    .limit(1);
  if (!r) throw new ApiException('REPORT_NOT_FOUND');
  const isAuthor = r.memberId === actor.memberId;
  if (!isAuthor && actor.companyRole !== 'company_admin' && !actor.isPlatformAdmin) {
    throw new ApiException('FORBIDDEN', '只能删除自己的日报', 403);
  }
  await db.delete(dailyReports).where(eq(dailyReports.id, id));
  return { id };
}

/* ---- stats (汇总页顶部:提交情况 + 7 日趋势 + 未提交名单) ----
   `today` 由客户端按其本地时区给出;日历日加减按 UTC 做纯字符串推算,
   不受服务器时区影响。 */
export async function reportStats(actor: Actor, today: string) {
  await requirePerm(actor, 'reports', 'read');
  assertDay(today);

  const shift = (offset: number): string => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const weekAgo = shift(-6);

  const [trendRows, todayRows, humanRows, totalRows] = await Promise.all([
    db
      .select({ date: dailyReports.date, count: sql<number>`count(*)::int` })
      .from(dailyReports)
      .where(
        and(
          eq(dailyReports.companyId, actor.companyId),
          gte(dailyReports.date, weekAgo),
          lte(dailyReports.date, today),
        ),
      )
      .groupBy(dailyReports.date),
    db
      .select({ memberId: dailyReports.memberId })
      .from(dailyReports)
      .where(and(eq(dailyReports.companyId, actor.companyId), eq(dailyReports.date, today))),
    // 未提交名单只统计内部成员(外部资源不登录系统,永远"未提交")。
    db
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(
        and(
          eq(members.companyId, actor.companyId),
          eq(members.type, 'human'),
          eq(members.origin, 'internal'),
          eq(members.status, 'active'),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(dailyReports)
      .where(eq(dailyReports.companyId, actor.companyId)),
  ]);

  const countByDate = new Map(trendRows.map((r) => [r.date, r.count]));
  const trend = Array.from({ length: 7 }, (_, i) => {
    const date = shift(-6 + i);
    return { date, count: countByDate.get(date) ?? 0 };
  });
  const submittedIds = new Set(todayRows.map((r) => r.memberId));
  const unsubmitted = humanRows.filter((m) => !submittedIds.has(m.id));

  return {
    totalReports: totalRows[0]?.count ?? 0,
    todayCount: submittedIds.size,
    memberCount: humanRows.length,
    trend,
    unsubmitted,
  };
}
