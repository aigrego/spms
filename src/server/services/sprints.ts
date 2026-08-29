import { and, asc, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { sprints, sprintProjects, sprintSnapshots, issues, projects, requirements } from '@/db/schema';
import { serializeIssueList, serializeRequirement } from '@/lib/serialize';
import { ApiException } from '@/lib/envelope';
import { requirePerm } from '@/lib/permissions';
import { assertProjectWritable, clampAllowed, issueVisible, visibleSetsFor } from '@/lib/visibility';
import { recordSprintSnapshot } from './sprintSnapshots';
import { archivedProjectIds } from './issues';
import type { Actor } from './types';

/* Sprint business service. Ported from apps/spms-server/src/routes/sprints.ts —
   plus createSprint / updateSprint / deleteSprint, which the blueprint did not
   have (see report). Shared by routes + MCP.

   Multi-company: every function takes the Actor and reads/writes strictly
   inside actor.companyId. Module gates: getBacklog → `backlog` read;
   everything else sprint-related → `sprints` read/write.

   A sprint spans one or more projects via the sprint_projects join table —
   a product split into module-projects runs one iteration cycle across them. */

const withRelations = {
  issueLabels: { with: { label: true } },
  subIssues: true,
  requirement: { columns: { key: true } },
} as const;

const DONE_STATUSES = ['done', 'canceled'];

/* 列表服务端上限(与 reports.ts 的 LIST_LIMIT=500 同口径):内存保护,
   超出按现有排序截断;不加分页参数、不改响应形状。 */
const LIST_LIMIT = 500;

/* drizzle 事务句柄(db.transaction 回调参数),供须入事务的私有 helper 使用。 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/* The projects a sprint spans (sprint_projects join). */
async function sprintProjectIds(companyId: string, sprintId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: sprintProjects.projectId })
    .from(sprintProjects)
    .where(and(eq(sprintProjects.companyId, companyId), eq(sprintProjects.sprintId, sprintId)));
  return rows.map((r) => r.projectId);
}

/* Attach projectIds to sprint rows with one grouped query. */
async function attachProjectIds<T extends { id: string }>(companyId: string, rows: T[]) {
  const links = rows.length
    ? await db
        .select()
        .from(sprintProjects)
        .where(
          and(
            eq(sprintProjects.companyId, companyId),
            inArray(
              sprintProjects.sprintId,
              rows.map((r) => r.id),
            ),
          ),
        )
    : [];
  const bySprint = new Map<string, string[]>();
  for (const l of links) bySprint.set(l.sprintId, [...(bySprint.get(l.sprintId) ?? []), l.projectId]);
  return rows.map((r) => ({ ...r, projectIds: bySprint.get(r.id) ?? [] }));
}

/* At most one active sprint per project — the lifecycle guard shared by
   startSprint and updateSprint 的状态流转转发(经 applyStartSprint 调用,在
   调用方的事务里执行)。A sprint spanning several projects conflicts when ANY
   of them is already covered by another active sprint. */
async function assertNoOtherActive(tx: Tx, companyId: string, projectIds: string[], excludeId: string) {
  if (!projectIds.length) return;
  const [other] = await tx
    .select({ id: sprintProjects.sprintId })
    .from(sprintProjects)
    .innerJoin(sprints, eq(sprints.id, sprintProjects.sprintId))
    .where(
      and(
        eq(sprintProjects.companyId, companyId),
        inArray(sprintProjects.projectId, projectIds),
        eq(sprints.status, 'active'),
        ne(sprints.id, excludeId),
      ),
    )
    .limit(1);
  if (other) throw new ApiException('CONFLICT', '该项目已有进行中的迭代');
}

/* 令牌项目白名单过滤条件:迭代须与白名单内至少一个项目有关联。 */
function allowedSprintCond(actor: Actor) {
  if (!actor.allowedProjectIds) return null;
  return inArray(
    sprints.id,
    db
      .select({ id: sprintProjects.sprintId })
      .from(sprintProjects)
      .where(
        and(
          eq(sprintProjects.companyId, actor.companyId),
          inArray(sprintProjects.projectId, actor.allowedProjectIds),
        ),
      ),
  );
}

/* 白名单下的详情门槛:迭代与白名单有交集才可读(0 项目迭代一律不可见,同旧 null 语义)。 */
function passesWhitelist(actor: Actor, projectIds: string[]): boolean {
  if (!actor.allowedProjectIds) return true;
  return projectIds.some((id) => actor.allowedProjectIds!.includes(id));
}

/* 迭代级写操作的可见性门槛:与 getSprint 读路径同一套过滤(指派可见性
   sprintIds + 令牌白名单项目交集),范围外按 SPRINT_NOT_FOUND 处理。
   返回该迭代的项目列表,供调用方继续使用。导出供 requirements 服务复用
   (需求关联迭代时同一套校验)。 */
export async function assertSprintWritable(actor: Actor, sprintId: string): Promise<string[]> {
  const visible = await visibleSetsFor(actor);
  if (visible && !visible.sprintIds.includes(sprintId)) throw new ApiException('SPRINT_NOT_FOUND');
  const projectIds = await sprintProjectIds(actor.companyId, sprintId);
  if (!passesWhitelist(actor, projectIds)) throw new ApiException('SPRINT_NOT_FOUND');
  return projectIds;
}

const sumPoints = (rows: { storyPoints: number | null }[]) =>
  rows.reduce((s, r) => s + (r.storyPoints ?? 0), 0);

type SprintRow = typeof sprints.$inferSelect;
export type SprintStatus = SprintRow['status'];

/* ---- list sprints (optionally by team), startDate asc ---- */
export async function listSprints(actor: Actor, filter?: { team?: string }) {
  await requirePerm(actor, 'sprints', 'read');
  const conds = [eq(sprints.companyId, actor.companyId)];
  if (filter?.team) conds.push(eq(sprints.teamId, filter.team));
  // 指派可见性(visibility.ts);null = 管理员不限制。
  const visible = await visibleSetsFor(actor);
  if (visible) conds.push(inArray(sprints.id, visible.sprintIds));
  // 令牌项目白名单:只看得到与白名单项目有交集的迭代(与 MCP loadBootstrap 同款)。
  const whitelist = allowedSprintCond(actor);
  if (whitelist) conds.push(whitelist);
  const rows = await db
    .select()
    .from(sprints)
    .where(and(...conds))
    .orderBy(asc(sprints.startDate));
  return attachProjectIds(actor.companyId, rows);
}

/* ---- product backlog: 未进入任何迭代 且状态为「待处理(todo)」的 issue,
   backlogRank asc。产品待办 = 敏捷 product backlog 概念:只放待规划进下一次
   迭代的待办工单,in_progress/testing/done/canceled/backlog 状态一律不进。 */
export async function getBacklog(actor: Actor, filter?: { team?: string }) {
  await requirePerm(actor, 'backlog', 'read');
  const conds = [eq(issues.companyId, actor.companyId), isNull(issues.sprintId), eq(issues.status, 'todo')];
  if (filter?.team) conds.push(eq(issues.teamId, filter.team));
  // 与 listIssues 同款:白名单 + 指派可见性(无项目 issue 公司级放行)。
  if (actor.allowedProjectIds) conds.push(inArray(issues.projectId, actor.allowedProjectIds));
  const visibleProjectIds = clampAllowed(actor, (await visibleSetsFor(actor))?.projectIds ?? null);
  if (visibleProjectIds) conds.push(or(isNull(issues.projectId), inArray(issues.projectId, visibleProjectIds))!);
  // 归档排除:已归档 issue 及已归档项目的 issue 不进规划面。
  conds.push(isNull(issues.archivedAt));
  conds.push(or(isNull(issues.projectId), notInArray(issues.projectId, await archivedProjectIds(actor.companyId)))!);
  const rows = await db.query.issues.findMany({
    where: and(...conds),
    with: withRelations,
    orderBy: [asc(issues.backlogRank)],
    limit: LIST_LIMIT,
  });
  return rows.map(serializeIssueList);
}

/* ---- velocity: completed points per sprint + avg over completed sprints ---- */
export async function getVelocity(actor: Actor, filter?: { team?: string }) {
  await requirePerm(actor, 'sprints', 'read');
  const conds = [eq(sprints.companyId, actor.companyId)];
  if (filter?.team) conds.push(eq(sprints.teamId, filter.team));
  // 指派可见性;null = 管理员不限制。
  const visible = await visibleSetsFor(actor);
  if (visible) conds.push(inArray(sprints.id, visible.sprintIds));
  // 令牌项目白名单:只看得到与白名单项目有交集的迭代。
  const whitelist = allowedSprintCond(actor);
  if (whitelist) conds.push(whitelist);
  const sprintRows = await db
    .select()
    .from(sprints)
    .where(and(...conds))
    .orderBy(asc(sprints.startDate));

  // 点数汇总一条 GROUP BY 拿全(原实现每迭代一次 issues 查询,N+1);
  // committed = 全部状态的点数和,completed = 仅 done,与逐条统计口径一致。
  const pointRows = sprintRows.length
    ? await db
        .select({
          sprintId: issues.sprintId,
          committed: sql<number>`coalesce(sum(${issues.storyPoints}), 0)::int`,
          completed: sql<number>`coalesce(sum(${issues.storyPoints}) filter (where ${issues.status} = 'done'), 0)::int`,
        })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, actor.companyId),
            inArray(
              issues.sprintId,
              sprintRows.map((s) => s.id),
            ),
          ),
        )
        .groupBy(issues.sprintId)
    : [];
  const pointsBySprint = new Map(pointRows.map((r) => [r.sprintId, r]));

  const series = sprintRows.map((s) => {
    const pts = pointsBySprint.get(s.id);
    return {
      sprintId: s.id,
      name: s.name,
      status: s.status,
      committed: pts?.committed ?? 0,
      completed: pts?.completed ?? 0,
      capacity: s.capacity,
    };
  });
  const completedOnly = series.filter((x) => x.status === 'completed');
  const avgVelocity = completedOnly.length
    ? Math.round(completedOnly.reduce((a, b) => a + b.completed, 0) / completedOnly.length)
    : null;
  return { series, avgVelocity };
}

/* ---- single sprint: meta + committed issues & requirements + computed stats.
   Missing or outside the actor's visibility → null ---- */
export async function getSprint(actor: Actor, id: string) {
  await requirePerm(actor, 'sprints', 'read');
  const sprint = await db.query.sprints.findFirst({
    where: and(eq(sprints.companyId, actor.companyId), eq(sprints.id, id)),
  });
  if (!sprint) return null;
  const visible = await visibleSetsFor(actor);
  if (visible && !visible.sprintIds.includes(id)) return null;
  // 令牌项目白名单:与白名单无交集的迭代详情不可读。
  const projectIds = await sprintProjectIds(actor.companyId, id);
  if (!passesWhitelist(actor, projectIds)) return null;

  const rows = await db.query.issues.findMany({
    where: and(eq(issues.companyId, actor.companyId), eq(issues.sprintId, id)),
    with: withRelations,
    orderBy: [asc(issues.backlogRank)],
  });
  const committedPoints = sumPoints(rows);
  const completedPoints = sumPoints(rows.filter((r) => r.status === 'done'));

  // 关联到迭代的需求(纯 AI 开发场景不拆 issue、直接按需求开发)。
  const reqRows = await db.query.requirements.findMany({
    where: and(eq(requirements.companyId, actor.companyId), eq(requirements.sprintId, id)),
    with: { issues: { columns: { key: true, status: true } } },
    orderBy: [asc(requirements.position)],
  });

  return {
    ...sprint,
    projectIds,
    issues: rows.map(serializeIssueList),
    requirements: reqRows.map(serializeRequirement),
    stats: {
      committedPoints,
      completedPoints,
      remainingPoints: committedPoints - completedPoints,
      issueCount: rows.length,
      doneCount: rows.filter((r) => DONE_STATUSES.includes(r.status)).length,
      requirementCount: reqRows.length,
    },
  };
}

/* ---- burndown: ideal (linear) vs. actual remaining points per day.
   Missing sprint or outside the actor's visibility → null. ---- */
export async function getBurndown(actor: Actor, id: string) {
  await requirePerm(actor, 'sprints', 'read');
  const sprint = await db.query.sprints.findFirst({
    where: and(eq(sprints.companyId, actor.companyId), eq(sprints.id, id)),
  });
  if (!sprint) return null;
  const visible = await visibleSetsFor(actor);
  if (visible && !visible.sprintIds.includes(id)) return null;
  // 令牌项目白名单:与白名单无交集的迭代燃尽不可读。
  if (!passesWhitelist(actor, await sprintProjectIds(actor.companyId, id))) return null;

  const committed = sumPoints(
    await db
      .select({ storyPoints: issues.storyPoints })
      .from(issues)
      .where(and(eq(issues.companyId, actor.companyId), eq(issues.sprintId, id))),
  );

  const snaps = await db
    .select()
    .from(sprintSnapshots)
    .where(and(eq(sprintSnapshots.companyId, actor.companyId), eq(sprintSnapshots.sprintId, id)))
    .orderBy(asc(sprintSnapshots.day));

  const start = +new Date(sprint.startDate);
  const end = +new Date(sprint.endDate);
  const totalDays = Math.max(1, Math.round((end - start) / 86_400_000));

  const points = [];
  for (let d = 0; d <= totalDays; d++) {
    const ideal = Math.max(0, +(committed - (committed / totalDays) * d).toFixed(1));
    const snap = snaps.find((s) => Math.round((+new Date(s.day) - start) / 86_400_000) === d);
    points.push({
      day: d,
      date: new Date(start + d * 86_400_000).toISOString(),
      ideal,
      actual: snap ? snap.remainingPoints : null,
    });
  }
  return { sprintId: id, committed, totalDays, points };
}

/* ---- move an issue into / out of a sprint (drag from backlog) ----
   sprintId is a sprint id or '_backlog'.
   一致性规则:迭代有项目时,issue 的项目必须在其中(LIFECYCLE_MISMATCH 报错,
   不再静默改写);issue 无项目且迭代恰好一个项目时自动归属(保留旧体验)。 */
export async function moveIssue(actor: Actor, sprintIdOrBacklog: string, issueKey: string, storyPoints?: number | null) {
  await requirePerm(actor, 'sprints', 'write');
  const issue = await db.query.issues.findFirst({
    where: and(eq(issues.companyId, actor.companyId), eq(issues.key, issueKey)),
  });
  if (!issue) throw new ApiException('ISSUE_NOT_FOUND', `Issue ${issueKey} 不存在`);
  // 目标 issue 须在可见范围内(令牌白名单 + 指派可见性),范围外按不存在处理。
  if (!(await issueVisible(actor, issue.projectId))) {
    throw new ApiException('ISSUE_NOT_FOUND', `Issue ${issueKey} 不存在`);
  }

  const targetSprint = sprintIdOrBacklog === '_backlog' ? null : sprintIdOrBacklog;
  const patch: Partial<typeof issues.$inferInsert> = { sprintId: targetSprint, updatedAt: new Date() };
  if (targetSprint) {
    const sprint = await db.query.sprints.findFirst({
      where: and(eq(sprints.companyId, actor.companyId), eq(sprints.id, targetSprint)),
    });
    if (!sprint) throw new ApiException('SPRINT_NOT_FOUND', `Sprint ${targetSprint} 不存在`);
    // 目标迭代也须在可见范围内(同 getSprint 的过滤),范围外按不存在处理。
    const projIds = await assertSprintWritable(actor, targetSprint);
    if (projIds.length > 0) {
      if (issue.projectId && !projIds.includes(issue.projectId)) {
        throw new ApiException('LIFECYCLE_MISMATCH', 'Issue 所属项目不在该迭代的项目范围内');
      }
      // 单项目迭代:无项目 issue 拖入后自动归属该项目(保留旧体验)。
      if (!issue.projectId && projIds.length === 1) patch.projectId = projIds[0];
    }
  }
  if (storyPoints !== undefined) patch.storyPoints = storyPoints;
  // 拖入迭代时未设点的 issue 默认 1 点,让燃尽/速度有基线;更大粒度再手动调。
  else if (targetSprint && issue.storyPoints == null) patch.storyPoints = 1;

  await db.update(issues).set(patch).where(eq(issues.id, issue.id));
  // 移入/移出/改点数都会改变燃尽剩余点数 → 新旧迭代各 upsert 一记当日快照。
  if (issue.sprintId && issue.sprintId !== targetSprint) {
    await recordSprintSnapshot(actor.companyId, issue.sprintId);
  }
  await recordSprintSnapshot(actor.companyId, targetSprint);
  return { issueId: issueKey, sprintId: targetSprint };
}

/* ------------------------------------------------------------------ */
/* Sprint CRUD — NEW (the blueprint had no sprint create/update/delete)  */
/* ------------------------------------------------------------------ */

function parseDate(v: Date | string, field: string): Date {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(+d)) throw new ApiException('VALIDATION_FAILED', `${field} 不是合法日期`);
  return d;
}

/* The legacy team a sprint inherits — derived from its (single) project. */
async function teamForProject(companyId: string, projectId: string | null | undefined) {
  if (!projectId) return null;
  const [p] = await db
    .select({ teamId: projects.teamId })
    .from(projects)
    .where(and(eq(projects.companyId, companyId), eq(projects.id, projectId)))
    .limit(1);
  return p?.teamId ?? null;
}

async function assertProjectsExist(companyId: string, ids: string[]) {
  if (!ids.length) return;
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.companyId, companyId), inArray(projects.id, ids)));
  if (rows.length !== new Set(ids).size) throw new ApiException('PROJECT_NOT_FOUND');
}

/* Replace the sprint's project links (delete + re-insert — 在调用方的事务里
   执行:先删后插若分属不同连接,中途失败会留下"关联被清空"的半截状态)。 */
async function setSprintProjects(tx: Tx, companyId: string, sprintId: string, projectIds: string[]) {
  await tx
    .delete(sprintProjects)
    .where(and(eq(sprintProjects.companyId, companyId), eq(sprintProjects.sprintId, sprintId)));
  if (projectIds.length) {
    await tx.insert(sprintProjects).values(
      [...new Set(projectIds)].map((projectId) => ({ companyId, sprintId, projectId })),
    );
  }
}

export interface CreateSprintInput {
  name: string;
  goal?: string | null;
  status?: SprintStatus;
  startDate: Date | string;
  endDate: Date | string;
  capacity?: number | null;
  projectIds?: string[];
  teamId?: string | null; // legacy; derived from the (single) project when not given
}

/* ---- create ---- */
export async function createSprint(actor: Actor, input: CreateSprintInput) {
  await requirePerm(actor, 'sprints', 'write');
  if (!input.name.trim()) throw new ApiException('VALIDATION_FAILED', '迭代名称不能为空');
  if (input.startDate === undefined || input.endDate === undefined) {
    throw new ApiException('VALIDATION_FAILED', '迭代开始/结束日期必填');
  }
  const startDate = parseDate(input.startDate, 'startDate');
  const endDate = parseDate(input.endDate, 'endDate');
  if (+endDate < +startDate) throw new ApiException('VALIDATION_FAILED', '结束日期不能早于开始日期');
  const projectIds = [...new Set(input.projectIds ?? [])];
  await assertProjectsExist(actor.companyId, projectIds);
  // 只能在可见项目内建迭代:入参项目逐个过写门槛,范围外 403。
  for (const projectId of projectIds) await assertProjectWritable(actor, projectId);

  const teamId =
    input.teamId !== undefined
      ? input.teamId
      : await teamForProject(actor.companyId, projectIds.length === 1 ? projectIds[0] : null);
  const id = crypto.randomUUID();
  // 迭代行 + 项目关联同生同灭 → 一个事务。
  await db.transaction(async (tx) => {
    await tx.insert(sprints).values({
      id,
      companyId: actor.companyId,
      name: input.name.trim(),
      goal: input.goal ?? null,
      status: input.status ?? 'planned',
      startDate,
      endDate,
      capacity: input.capacity ?? null,
      teamId,
    });
    await setSprintProjects(tx, actor.companyId, id, projectIds);
  });
  const [row] = await attachProjectIds(actor.companyId, [
    (await db.select().from(sprints).where(eq(sprints.id, id)).limit(1))[0],
  ]);
  return row;
}

export interface UpdateSprintInput {
  name?: string;
  goal?: string | null;
  status?: SprintStatus;
  startDate?: Date | string;
  endDate?: Date | string;
  capacity?: number | null;
  projectIds?: string[];
  teamId?: string | null;
}

/* ---- update (partial) ----
   状态机收口(TKT-17):status 不允许裸改绕过流程。planned→active /
   active→completed 两种合法流转转发到 startSprint/completeSprint 的同一套
   落库核心(applyStartSprint/applyCompleteSprint;前端 SprintModal 编辑时整体
   PATCH,行为不变);status 不变视为无操作;其余流转(completed 回退、planned
   直接 completed 等)一律 VALIDATION_FAILED —— 完成迭代必须走「未完成 issue
   退回待办」的完整流程,不能裸改状态。 */
export async function updateSprint(actor: Actor, id: string, input: UpdateSprintInput) {
  await requirePerm(actor, 'sprints', 'write');
  const [existing] = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.companyId, actor.companyId), eq(sprints.id, id)))
    .limit(1);
  if (!existing) throw new ApiException('SPRINT_NOT_FOUND');
  // 迭代须在可见范围内(同 getSprint 的过滤),范围外按不存在处理。
  const existingProjectIds = await assertSprintWritable(actor, id);
  const projectIds = input.projectIds !== undefined ? [...new Set(input.projectIds)] : undefined;
  if (projectIds) {
    await assertProjectsExist(actor.companyId, projectIds);
    // 改入的新项目也必须在可见范围内,范围外 403。
    for (const projectId of projectIds) await assertProjectWritable(actor, projectId);
  }

  // 状态流转判定:仅 planned→active / active→completed 两种,其余拒绝。
  let lifecycle: 'start' | 'complete' | null = null;
  if (input.status !== undefined && input.status !== existing.status) {
    if (existing.status === 'planned' && input.status === 'active') lifecycle = 'start';
    else if (existing.status === 'active' && input.status === 'completed') lifecycle = 'complete';
    else {
      throw new ApiException(
        'VALIDATION_FAILED',
        `迭代状态不支持 ${existing.status} → ${input.status},请使用启动/完成流程`,
      );
    }
  }

  const patch: Partial<typeof sprints.$inferInsert> = {};
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new ApiException('VALIDATION_FAILED', '迭代名称不能为空');
    patch.name = input.name.trim();
  }
  if (input.goal !== undefined) patch.goal = input.goal;
  if (input.startDate !== undefined) patch.startDate = parseDate(input.startDate, 'startDate');
  if (input.endDate !== undefined) patch.endDate = parseDate(input.endDate, 'endDate');
  // Validate the effective date range when either side changes.
  const effStart = patch.startDate ?? existing.startDate;
  const effEnd = patch.endDate ?? existing.endDate;
  if (+effEnd < +effStart) throw new ApiException('VALIDATION_FAILED', '结束日期不能早于开始日期');
  if (input.capacity !== undefined) patch.capacity = input.capacity;
  if (projectIds) {
    // Keep the legacy teamId aligned unless explicitly overridden.
    if (input.teamId === undefined) {
      patch.teamId = await teamForProject(actor.companyId, projectIds.length === 1 ? projectIds[0] : null);
    }
  }
  if (input.teamId !== undefined) patch.teamId = input.teamId;

  // 关联替换 / 状态流转 / 字段补丁收进一个事务,不再留下半截组合状态。
  await db.transaction(async (tx) => {
    if (projectIds) await setSprintProjects(tx, actor.companyId, id, projectIds);
    if (lifecycle === 'start') await applyStartSprint(tx, actor.companyId, id, projectIds ?? existingProjectIds);
    else if (lifecycle === 'complete') await applyCompleteSprint(tx, actor.companyId, id);
    if (Object.keys(patch).length) await tx.update(sprints).set(patch).where(eq(sprints.id, id));
  });
  // 启动/完成都改变燃尽锚点 → 事务提交后补记快照(同 startSprint/completeSprint)。
  if (lifecycle) await recordSprintSnapshot(actor.companyId, id);
  const [row] = await attachProjectIds(actor.companyId, [
    (await db.select().from(sprints).where(eq(sprints.id, id)).limit(1))[0],
  ]);
  return row;
}

/* planned→active 的落库核心(在调用方的事务里执行):唯一 active 守卫 + 置
   状态。startSprint 与 updateSprint 的合法流转转发共用;启动基线快照由调用方
   在事务提交后补记。 */
async function applyStartSprint(tx: Tx, companyId: string, id: string, projectIds: string[]) {
  await assertNoOtherActive(tx, companyId, projectIds, id);
  await tx.update(sprints).set({ status: 'active' }).where(eq(sprints.id, id));
}

/* active→completed 的落库核心(在调用方的事务里执行):未完成 issue 退回产品
   待办(sprintId → null,保留项目),未交付需求(shipped/rejected 之外)同样退出
   迭代,再置状态;返回退回数量(issue + 需求合计)。completeSprint 与
   updateSprint 的合法流转转发共用;收尾快照由调用方在事务提交后补记。 */
async function applyCompleteSprint(tx: Tx, companyId: string, id: string): Promise<number> {
  const moved = await tx
    .update(issues)
    .set({ sprintId: null })
    .where(
      and(
        eq(issues.companyId, companyId),
        eq(issues.sprintId, id),
        notInArray(issues.status, ['done', 'canceled']),
      ),
    )
    .returning({ id: issues.id });
  const movedReqs = await tx
    .update(requirements)
    .set({ sprintId: null, updatedAt: new Date() })
    .where(
      and(
        eq(requirements.companyId, companyId),
        eq(requirements.sprintId, id),
        notInArray(requirements.status, ['shipped', 'rejected']),
      ),
    )
    .returning({ id: requirements.id });
  await tx.update(sprints).set({ status: 'completed' }).where(eq(sprints.id, id));
  return moved.length + movedReqs.length;
}

/* ---- lifecycle: start (planned → active) ---- */
export async function startSprint(actor: Actor, id: string) {
  await requirePerm(actor, 'sprints', 'write');
  const [existing] = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.companyId, actor.companyId), eq(sprints.id, id)))
    .limit(1);
  if (!existing) throw new ApiException('SPRINT_NOT_FOUND');
  // 迭代须在可见范围内(同 getSprint 的过滤),范围外按不存在处理。
  const projectIds = await assertSprintWritable(actor, id);
  if (existing.status !== 'planned') {
    throw new ApiException('VALIDATION_FAILED', '仅待开始的迭代可以启动');
  }
  await db.transaction(async (tx) => applyStartSprint(tx, actor.companyId, id, projectIds));
  // 启动当天记基线快照,燃尽 actual 线从第 0 天起有锚点。
  await recordSprintSnapshot(actor.companyId, id);
  const [row] = await attachProjectIds(actor.companyId, [
    (await db.select().from(sprints).where(eq(sprints.id, id)).limit(1))[0],
  ]);
  return row;
}

/* ---- lifecycle: complete (active → completed) ----
   Unfinished issues move back to the product backlog (sprintId → null, they
   keep their project); done/canceled issues stay on the completed sprint.
   Unshipped requirements (not shipped/rejected) likewise leave the sprint. */
export async function completeSprint(actor: Actor, id: string) {
  await requirePerm(actor, 'sprints', 'write');
  const [existing] = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.companyId, actor.companyId), eq(sprints.id, id)))
    .limit(1);
  if (!existing) throw new ApiException('SPRINT_NOT_FOUND');
  // 迭代须在可见范围内(同 getSprint 的过滤),范围外按不存在处理。
  await assertSprintWritable(actor, id);
  if (existing.status !== 'active') {
    throw new ApiException('VALIDATION_FAILED', '仅进行中的迭代可以完成');
  }
  // 批量退回 + 置状态同生同灭 → 一个事务(与 updateSprint 的流转转发同一核心)。
  const movedCount = await db.transaction(async (tx) => applyCompleteSprint(tx, actor.companyId, id));
  // 收尾快照:未完成 issue 已退回待办,记录迭代最终的剩余点数。
  await recordSprintSnapshot(actor.companyId, id);
  const [row] = await attachProjectIds(actor.companyId, [
    (await db.select().from(sprints).where(eq(sprints.id, id)).limit(1))[0],
  ]);
  return { sprint: row, movedCount };
}

/* ---- delete ---- (committed issues & requirements detach: sprintId → null) */
export async function deleteSprint(actor: Actor, id: string) {
  await requirePerm(actor, 'sprints', 'write');
  const [existing] = await db
    .select({ id: sprints.id })
    .from(sprints)
    .where(and(eq(sprints.companyId, actor.companyId), eq(sprints.id, id)))
    .limit(1);
  if (!existing) throw new ApiException('SPRINT_NOT_FOUND');
  // 迭代须在可见范围内(同 getSprint 的过滤),范围外按不存在处理。
  await assertSprintWritable(actor, id);
  // Explicit detach (the DB FK also has onDelete: 'set null'; doing it here keeps
  // the behavior independent of migration state). Issues keep their project.
  await db
    .update(issues)
    .set({ sprintId: null })
    .where(and(eq(issues.companyId, actor.companyId), eq(issues.sprintId, id)));
  await db
    .update(requirements)
    .set({ sprintId: null, updatedAt: new Date() })
    .where(and(eq(requirements.companyId, actor.companyId), eq(requirements.sprintId, id)));
  await db.delete(sprints).where(eq(sprints.id, id));
  return { id };
}
