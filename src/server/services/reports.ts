import { and, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { dailyReportEntries, dailyReports, members, products, projects, releases } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { requirePerm } from '@/lib/permissions';
import { formatReportContent } from '@/lib/reportMarkdown';
import { LIST_LIMIT } from './shared';
import type { Actor } from './types';

/* Daily report service (日报模块).

   每人每天一份日报,内容按产品拆成 entries —— 汇总视图按 产品 → 人员 → 任务
   上卷,供负责人统一上报。日期是客户端本地时区的 'YYYY-MM-DD' 日历日,服务端
   把它当作不透明的 day key,绝不自行推导「今天」(避免 UTC 偏移 bug)。

   模块门:'reports'。read = 查看日报(行级可见,见 canViewAll);write = 提交/编辑自己的
   日报;删除他人日报需 company_admin / 平台管理员。 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_CONTENT_LEN = 4000;

function assertDay(date: string): void {
  if (!DAY_RE.test(date)) throw new ApiException('VALIDATION_FAILED', '日期格式应为 YYYY-MM-DD');
}

/* 行级可见性(日报读):
     - company_admin / 平台管理员:全公司可见;
     - 其他成员:本人日报的全部条目 + 他人日报中属于自己负责产品
       (products.leadId = 我)的条目;过滤后无可见条目的他人日报不返回;
     - memberId 为 null(无席位)且非管理员:空集。
   list / stats 共用同一谓词;汇总、复制汇总在前端消费 list,自然生效。 */
function canViewAll(actor: Actor): boolean {
  return actor.isPlatformAdmin || actor.companyRole === 'company_admin';
}

/* 非管理员可见的日报 id 子查询:本人日报,或含我负责产品条目的日报。
   调用前须保证 actor.memberId 非空。 */
function visibleReportIdsSubquery(actor: Actor) {
  return db
    .selectDistinct({ id: dailyReports.id })
    .from(dailyReports)
    .leftJoin(dailyReportEntries, eq(dailyReportEntries.reportId, dailyReports.id))
    .leftJoin(products, eq(products.id, dailyReportEntries.productId))
    .where(
      and(
        eq(dailyReports.companyId, actor.companyId),
        or(eq(dailyReports.memberId, actor.memberId!), eq(products.leadId, actor.memberId!)),
      ),
    );
}

export interface ReportEntryInput {
  productId: string;
  content: string;
}

export interface ReportEntryView {
  id: string;
  productId: string;
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
    list.push({ id: e.id, productId: e.productId, content: e.content, position: e.position });
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
  productId?: string;
}

export async function listReports(actor: Actor, filter: ListReportsFilter = {}): Promise<ReportView[]> {
  await requirePerm(actor, 'reports', 'read');
  const viewAll = canViewAll(actor);
  if (!viewAll && !actor.memberId) return []; // 无席位且非管理员 → 看不到任何日报
  const conds = [eq(dailyReports.companyId, actor.companyId)];
  if (!viewAll) conds.push(inArray(dailyReports.id, visibleReportIdsSubquery(actor)));
  if (filter.startDate) {
    assertDay(filter.startDate);
    conds.push(gte(dailyReports.date, filter.startDate));
  }
  if (filter.endDate) {
    assertDay(filter.endDate);
    conds.push(lte(dailyReports.date, filter.endDate));
  }
  if (filter.memberId) conds.push(eq(dailyReports.memberId, filter.memberId));
  if (filter.productId) {
    const hits = await db
      .select({ reportId: dailyReportEntries.reportId })
      .from(dailyReportEntries)
      .where(and(eq(dailyReportEntries.companyId, actor.companyId), eq(dailyReportEntries.productId, filter.productId)));
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
  if (viewAll) {
    const entryRows = await db
      .select()
      .from(dailyReportEntries)
      .where(inArray(dailyReportEntries.reportId, reportRows.map((r) => r.id)));
    return groupEntries(reportRows, entryRows);
  }
  // 非管理员:entry 级过滤 —— 本人日报全条目可见;他人日报仅保留我负责产品的条目,
  // 过滤后无可见条目的日报整体剔除。
  const authorById = new Map(reportRows.map((r) => [r.id, r.memberId]));
  const entryRows = await db
    .select({ entry: dailyReportEntries, leadId: products.leadId })
    .from(dailyReportEntries)
    .leftJoin(products, eq(products.id, dailyReportEntries.productId))
    .where(inArray(dailyReportEntries.reportId, reportRows.map((r) => r.id)));
  const visible = groupEntries(
    reportRows,
    entryRows
      .filter((e) => authorById.get(e.entry.reportId) === actor.memberId || e.leadId === actor.memberId)
      .map((e) => e.entry),
  );
  return visible.filter((r) => r.entries.length > 0);
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

/* 清洗日报条目:trim、按产品去重、条数下限。dropEmpty=true(覆盖提交)时空内容块
   静默丢弃(空 = 不填该产品的语义),且不查单条长度(由 zod 层 reportUpsertSchema
   校验);dropEmpty=false(合并提交)时空内容直接报错——合并语义下静默丢弃会让
   调用方误以为已提交——并兜单条长度上限。 */
function cleanEntries(raw: ReportEntryInput[], opts: { dropEmpty: boolean }): ReportEntryInput[] {
  const seen = new Set<string>();
  const entries: ReportEntryInput[] = [];
  for (const e of raw) {
    const content = (e?.content ?? '').trim();
    if (opts.dropEmpty && !content) continue;
    if (typeof e?.productId !== 'string' || !e.productId) throw new ApiException('VALIDATION_FAILED', '缺少产品');
    if (!content) throw new ApiException('VALIDATION_FAILED', '日报内容不能为空');
    if (!opts.dropEmpty && content.length > MAX_CONTENT_LEN) {
      throw new ApiException('VALIDATION_FAILED', `单产品内容不能超过 ${MAX_CONTENT_LEN} 字`);
    }
    if (seen.has(e.productId)) throw new ApiException('VALIDATION_FAILED', '同一产品只能填写一段内容');
    seen.add(e.productId);
    entries.push({ productId: e.productId, content });
  }
  if (entries.length === 0) throw new ApiException('VALIDATION_FAILED', '至少填写一个产品的内容');
  return entries;
}

/* 产品必须属于本公司且未归档。 */
async function assertWritableProducts(companyId: string, entries: ReportEntryInput[]): Promise<void> {
  const prodRows = await db
    .select({ id: products.id, status: products.status })
    .from(products)
    .where(and(eq(products.companyId, companyId), inArray(products.id, entries.map((e) => e.productId))));
  const writableIds = new Set(prodRows.filter((p) => p.status !== 'archived').map((p) => p.id));
  for (const e of entries) {
    if (!writableIds.has(e.productId)) throw new ApiException('PRODUCT_NOT_FOUND');
  }
}

export async function upsertMyReport(
  actor: Actor,
  input: { date: string; entries: ReportEntryInput[] },
): Promise<ReportView> {
  await requirePerm(actor, 'reports', 'write');
  if (!actor.memberId) throw new ApiException('FORBIDDEN', '需要公司席位才能提交日报', 403);
  // 日期格式/entries 形状/单条长度由 zod 层(reportUpsertSchema)校验。

  // 覆盖提交:空内容块静默丢弃(空 = 不填该产品的语义)。
  const entries = cleanEntries(input.entries, { dropEmpty: true });
  await assertWritableProducts(actor.companyId, entries);

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
        productId: e.productId,
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

/* ---- merge my report entries (合并提交:按 (reportId, productId) 逐条 upsert,
   未提交的产品条目保持不动;MCP spms_submit_report 走这里,避免多项目/token
   分别上报时互相覆盖。已存在的产品条目默认追加(mode='append')新内容而非覆盖,
   仅当调用方显式传 mode='replace' 时才整体替换该条目内容) ---- */
export interface MergeReportResult {
  report: ReportView;
  created: string[]; // 本次新建条目的 productId
  updated: string[]; // 本次更新（追加/替换）条目的 productId
}

export async function mergeMyReportEntries(
  actor: Actor,
  date: string,
  input: ReportEntryInput[],
  opts: { mode?: 'append' | 'replace' } = {},
): Promise<MergeReportResult> {
  await requirePerm(actor, 'reports', 'write');
  if (!actor.memberId) throw new ApiException('FORBIDDEN', '需要公司席位才能提交日报', 403);
  assertDay(date);
  if (!Array.isArray(input)) throw new ApiException('VALIDATION_FAILED', '缺少日报内容');

  // 合并提交:空内容报错(静默丢弃会让调用方误以为已提交),并兜单条长度上限。
  const entries = cleanEntries(input, { dropEmpty: false });
  await assertWritableProducts(actor.companyId, entries);

  const { reportId, created, updated } = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: dailyReports.id })
      .from(dailyReports)
      .where(
        and(
          eq(dailyReports.companyId, actor.companyId),
          eq(dailyReports.memberId, actor.memberId!),
          eq(dailyReports.date, date),
        ),
      )
      .limit(1);
    let id: string;
    if (existing) {
      id = existing.id;
      await tx.update(dailyReports).set({ updatedAt: new Date() }).where(eq(dailyReports.id, id));
    } else {
      id = crypto.randomUUID();
      await tx
        .insert(dailyReports)
        .values({ id, companyId: actor.companyId, memberId: actor.memberId!, date });
    }
    // 逐条 upsert:已存在的产品条目默认把新内容追加到原内容末尾(mode='append',
    // 保留原 position),仅 mode='replace' 时整体替换;新条目 position 取现有最大
    // position 起递增。未涉及的产品条目不动。
    const mode = opts.mode ?? 'append';
    const existingEntries = await tx
      .select({
        id: dailyReportEntries.id,
        productId: dailyReportEntries.productId,
        content: dailyReportEntries.content,
        position: dailyReportEntries.position,
      })
      .from(dailyReportEntries)
      .where(eq(dailyReportEntries.reportId, id));
    const entryByProduct = new Map(existingEntries.map((r) => [r.productId, r]));
    let nextPosition = existingEntries.reduce((max, r) => Math.max(max, r.position), -1) + 1;
    const created: string[] = [];
    const updated: string[] = [];
    for (const e of entries) {
      const existingEntry = entryByProduct.get(e.productId);
      if (existingEntry) {
        const content = mode === 'replace' ? e.content : `${existingEntry.content}\n${e.content}`;
        if (content.length > MAX_CONTENT_LEN) {
          throw new ApiException('VALIDATION_FAILED', `追加后单产品内容超过 ${MAX_CONTENT_LEN} 字上限`);
        }
        await tx.update(dailyReportEntries).set({ content }).where(eq(dailyReportEntries.id, existingEntry.id));
        updated.push(e.productId);
      } else {
        await tx.insert(dailyReportEntries).values({
          id: crypto.randomUUID(),
          reportId: id,
          companyId: actor.companyId,
          productId: e.productId,
          content: e.content,
          position: nextPosition++,
        });
        created.push(e.productId);
      }
    }
    return { reportId: id, created, updated };
  });

  const [r] = await db.select().from(dailyReports).where(eq(dailyReports.id, reportId)).limit(1);
  const entryRows = await db.select().from(dailyReportEntries).where(eq(dailyReportEntries.reportId, reportId));
  return { report: groupEntries([r], entryRows)[0], created, updated };
}

/* ---- submit by projects (MCP spms_submit_report：按项目上报日报) ----
   entries 按项目给出，服务端负责 项目解析 → 令牌白名单校验 → 项目→版本→产品
   推导 → 同产品查重，再交给 mergeMyReportEntries 合并落库；content 规整为
   简单 Markdown。created/updated 以产品 key/name 标注返回。 */
export interface SubmitReportEntryInput {
  project: string; // 项目 id 或项目名（精确匹配，projects 表无 key 列）
  content: string;
}

export async function submitMyReportByProjects(
  actor: Actor,
  input: { date: string; entries: SubmitReportEntryInput[]; mode?: 'append' | 'replace' },
) {
  // 项目解析：公司内先按 id 再按 name 精确匹配（projects 表无 key 列）。
  const wanted = [...new Set(input.entries.map((e) => e.project))];
  const projRows = await db
    .select({ id: projects.id, name: projects.name, releaseId: projects.releaseId })
    .from(projects)
    .where(and(eq(projects.companyId, actor.companyId), or(inArray(projects.id, wanted), inArray(projects.name, wanted))));
  const byId = new Map(projRows.map((r) => [r.id, r]));
  const byName = new Map(projRows.map((r) => [r.name, r]));
  const resolved = input.entries.map((e) => {
    const proj = byId.get(e.project) ?? byName.get(e.project);
    if (!proj) throw new ApiException('PROJECT_NOT_FOUND', `项目 ${e.project} 不存在`);
    return { proj, content: e.content };
  });
  // 令牌项目白名单强制收窄（与 issue 写操作同规则）。
  if (actor.allowedProjectIds) {
    for (const { proj } of resolved) {
      if (!actor.allowedProjectIds.includes(proj.id)) {
        throw new ApiException('FORBIDDEN', `项目 ${proj.name} 不在令牌的项目白名单内`, 403);
      }
    }
  }
  // 产品推导：项目 → releaseId → releases.productId。
  const releaseIds = [...new Set(resolved.map((r) => r.proj.releaseId).filter((x): x is string => x != null))];
  const releaseRows = releaseIds.length
    ? await db
        .select({ id: releases.id, productId: releases.productId })
        .from(releases)
        .where(and(eq(releases.companyId, actor.companyId), inArray(releases.id, releaseIds)))
    : [];
  const productIdByRelease = new Map(releaseRows.map((r) => [r.id, r.productId]));
  const productIdByProject = new Map<string, string>();
  for (const { proj } of resolved) {
    if (!proj.releaseId) {
      throw new ApiException('VALIDATION_FAILED', `项目 ${proj.name} 未关联版本，无法推导产品`);
    }
    const productId = productIdByRelease.get(proj.releaseId);
    if (!productId) throw new ApiException('VALIDATION_FAILED', `项目 ${proj.name} 关联的版本不存在，无法推导产品`);
    productIdByProject.set(proj.id, productId);
  }
  // 一次调用内两个项目推导到同一产品 → 要求调用方先合并内容。
  const firstProjectByProduct = new Map<string, string>();
  for (const { proj } of resolved) {
    const productId = productIdByProject.get(proj.id)!;
    const first = firstProjectByProduct.get(productId);
    if (first) {
      throw new ApiException(
        'VALIDATION_FAILED',
        `项目 ${first} 与项目 ${proj.name} 推导到同一产品，请先合并内容再提交（同一产品一次提交只能出现一次）`,
      );
    }
    firstProjectByProduct.set(productId, proj.name);
  }
  const entries = resolved.map((r) => ({
    productId: productIdByProject.get(r.proj.id)!,
    // 上报内容规整为简单 Markdown（普通行 → `- ` 列表项），汇总视图按 Markdown 渲染。
    content: formatReportContent(r.content),
  }));
  const { report, created, updated } = await mergeMyReportEntries(actor, input.date, entries, { mode: input.mode });
  // created/updated 以产品 key/name 标注，便于调用方确认推导结果。
  const productIds = [...created, ...updated];
  const prodRows = productIds.length
    ? await db
        .select({ id: products.id, key: products.key, name: products.name })
        .from(products)
        .where(and(eq(products.companyId, actor.companyId), inArray(products.id, productIds)))
    : [];
  const prodById = new Map(prodRows.map((r) => [r.id, r]));
  const label = (id: string) => {
    const p = prodById.get(id);
    return p ? `${p.key}（${p.name}）` : id;
  };
  return {
    ...report,
    created: created.map(label),
    updated: updated.map(label),
    note: '合并提交：同日重复提交同一产品会更新该产品条目，不影响其他产品',
  };
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

  // 行级可见性:非管理员只统计自己可见的日报(谓词同 listReports);
  // 无席位 → 看不到任何日报;未提交名单仅对管理员返回。
  const viewAll = canViewAll(actor);
  const scopeCond: SQL | null = viewAll
    ? null
    : actor.memberId
      ? inArray(dailyReports.id, visibleReportIdsSubquery(actor))
      : sql`false`;

  const [trendRows, todayRows, humanRows, totalRows] = await Promise.all([
    db
      .select({ date: dailyReports.date, count: sql<number>`count(*)::int` })
      .from(dailyReports)
      .where(
        and(
          eq(dailyReports.companyId, actor.companyId),
          gte(dailyReports.date, weekAgo),
          lte(dailyReports.date, today),
          ...(scopeCond ? [scopeCond] : []),
        ),
      )
      .groupBy(dailyReports.date),
    db
      .select({ memberId: dailyReports.memberId })
      .from(dailyReports)
      .where(and(eq(dailyReports.companyId, actor.companyId), eq(dailyReports.date, today), ...(scopeCond ? [scopeCond] : []))),
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
      .where(and(eq(dailyReports.companyId, actor.companyId), ...(scopeCond ? [scopeCond] : []))),
  ]);

  const countByDate = new Map(trendRows.map((r) => [r.date, r.count]));
  const trend = Array.from({ length: 7 }, (_, i) => {
    const date = shift(-6 + i);
    return { date, count: countByDate.get(date) ?? 0 };
  });
  const submittedIds = new Set(todayRows.map((r) => r.memberId));
  const unsubmitted = viewAll ? humanRows.filter((m) => !submittedIds.has(m.id)) : [];

  return {
    totalReports: totalRows[0]?.count ?? 0,
    todayCount: submittedIds.size,
    memberCount: humanRows.length,
    trend,
    unsubmitted,
  };
}
