import { and, asc, eq, inArray, isNull, ne, notInArray, or } from 'drizzle-orm';
import { db } from '@/db';
import { sprints, sprintProjects, sprintSnapshots, issues, projects } from '@/db/schema';
import { serializeIssueList } from '@/lib/serialize';
import { ApiException } from '@/lib/envelope';
import { requirePerm } from '@/lib/permissions';
import { clampAllowed, visibleSetsFor } from '@/lib/visibility';
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
   startSprint and the raw status PATCH. A sprint spanning several projects
   conflicts when ANY of them is already covered by another active sprint. */
async function assertNoOtherActive(companyId: string, projectIds: string[], excludeId: string) {
  if (!projectIds.length) return;
  const [other] = await db
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

  const series = [];
  for (const s of sprintRows) {
    const rows = await db
      .select({ storyPoints: issues.storyPoints, status: issues.status })
      .from(issues)
      .where(and(eq(issues.companyId, actor.companyId), eq(issues.sprintId, s.id)));
    series.push({
      sprintId: s.id,
      name: s.name,
      status: s.status,
      committed: sumPoints(rows),
      completed: sumPoints(rows.filter((r) => r.status === 'done')),
      capacity: s.capacity,
    });
  }
  const completedOnly = series.filter((x) => x.status === 'completed');
  const avgVelocity = completedOnly.length
    ? Math.round(completedOnly.reduce((a, b) => a + b.completed, 0) / completedOnly.length)
    : null;
  return { series, avgVelocity };
}

/* ---- single sprint: meta + committed issues + computed stats.
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

  return {
    ...sprint,
    projectIds,
    issues: rows.map(serializeIssueList),
    stats: {
      committedPoints,
      completedPoints,
      remainingPoints: committedPoints - completedPoints,
      issueCount: rows.length,
      doneCount: rows.filter((r) => DONE_STATUSES.includes(r.status)).length,
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

  const targetSprint = sprintIdOrBacklog === '_backlog' ? null : sprintIdOrBacklog;
  const patch: Partial<typeof issues.$inferInsert> = { sprintId: targetSprint, updatedAt: new Date() };
  if (targetSprint) {
    const sprint = await db.query.sprints.findFirst({
      where: and(eq(sprints.companyId, actor.companyId), eq(sprints.id, targetSprint)),
    });
    if (!sprint) throw new ApiException('SPRINT_NOT_FOUND', `Sprint ${targetSprint} 不存在`);
    const projIds = await sprintProjectIds(actor.companyId, targetSprint);
    if (projIds.length > 0) {
      if (issue.projectId && !projIds.includes(issue.projectId)) {
        throw new ApiException('LIFECYCLE_MISMATCH', 'Issue 所属项目不在该迭代的项目范围内');
      }
      // 单项目迭代:无项目 issue 拖入后自动归属该项目(保留旧体验)。
      if (!issue.projectId && projIds.length === 1) patch.projectId = projIds[0];
    }
  }
  if (storyPoints !== undefined) patch.storyPoints = storyPoints;

  await db.update(issues).set(patch).where(eq(issues.id, issue.id));
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

/* Replace the sprint's project links (delete + re-insert). */
async function setSprintProjects(companyId: string, sprintId: string, projectIds: string[]) {
  await db
    .delete(sprintProjects)
    .where(and(eq(sprintProjects.companyId, companyId), eq(sprintProjects.sprintId, sprintId)));
  if (projectIds.length) {
    await db.insert(sprintProjects).values(
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

  const id = crypto.randomUUID();
  await db.insert(sprints).values({
    id,
    companyId: actor.companyId,
    name: input.name.trim(),
    goal: input.goal ?? null,
    status: input.status ?? 'planned',
    startDate,
    endDate,
    capacity: input.capacity ?? null,
    teamId:
      input.teamId !== undefined
        ? input.teamId
        : await teamForProject(actor.companyId, projectIds.length === 1 ? projectIds[0] : null),
  });
  await setSprintProjects(actor.companyId, id, projectIds);
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

/* ---- update (partial) ---- */
export async function updateSprint(actor: Actor, id: string, input: UpdateSprintInput) {
  await requirePerm(actor, 'sprints', 'write');
  const [existing] = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.companyId, actor.companyId), eq(sprints.id, id)))
    .limit(1);
  if (!existing) throw new ApiException('SPRINT_NOT_FOUND');
  const projectIds = input.projectIds !== undefined ? [...new Set(input.projectIds)] : undefined;
  if (projectIds) await assertProjectsExist(actor.companyId, projectIds);

  const patch: Partial<typeof sprints.$inferInsert> = {};
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new ApiException('VALIDATION_FAILED', '迭代名称不能为空');
    patch.name = input.name.trim();
  }
  if (input.goal !== undefined) patch.goal = input.goal;
  if (input.status !== undefined) {
    // Defense line for raw status PATCHes: activating a sprint goes through the
    // same one-active-per-project rule as startSprint. (The UI drives planned→
    // active→completed via the dedicated start/complete endpoints.)
    if (input.status === 'active' && existing.status !== 'active') {
      const effProjects = projectIds ?? (await sprintProjectIds(actor.companyId, id));
      await assertNoOtherActive(actor.companyId, effProjects, id);
    }
    patch.status = input.status;
  }
  if (input.startDate !== undefined) patch.startDate = parseDate(input.startDate, 'startDate');
  if (input.endDate !== undefined) patch.endDate = parseDate(input.endDate, 'endDate');
  // Validate the effective date range when either side changes.
  const effStart = patch.startDate ?? existing.startDate;
  const effEnd = patch.endDate ?? existing.endDate;
  if (+effEnd < +effStart) throw new ApiException('VALIDATION_FAILED', '结束日期不能早于开始日期');
  if (input.capacity !== undefined) patch.capacity = input.capacity;
  if (projectIds) {
    await setSprintProjects(actor.companyId, id, projectIds);
    // Keep the legacy teamId aligned unless explicitly overridden.
    if (input.teamId === undefined) {
      patch.teamId = await teamForProject(actor.companyId, projectIds.length === 1 ? projectIds[0] : null);
    }
  }
  if (input.teamId !== undefined) patch.teamId = input.teamId;

  await db.update(sprints).set(patch).where(eq(sprints.id, id));
  const [row] = await attachProjectIds(actor.companyId, [
    (await db.select().from(sprints).where(eq(sprints.id, id)).limit(1))[0],
  ]);
  return row;
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
  if (existing.status !== 'planned') {
    throw new ApiException('VALIDATION_FAILED', '仅待开始的迭代可以启动');
  }
  await assertNoOtherActive(actor.companyId, await sprintProjectIds(actor.companyId, id), id);
  await db.update(sprints).set({ status: 'active' }).where(eq(sprints.id, id));
  const [row] = await attachProjectIds(actor.companyId, [
    (await db.select().from(sprints).where(eq(sprints.id, id)).limit(1))[0],
  ]);
  return row;
}

/* ---- lifecycle: complete (active → completed) ----
   Unfinished issues move back to the product backlog (sprintId → null, they
   keep their project); done/canceled issues stay on the completed sprint. */
export async function completeSprint(actor: Actor, id: string) {
  await requirePerm(actor, 'sprints', 'write');
  const [existing] = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.companyId, actor.companyId), eq(sprints.id, id)))
    .limit(1);
  if (!existing) throw new ApiException('SPRINT_NOT_FOUND');
  if (existing.status !== 'active') {
    throw new ApiException('VALIDATION_FAILED', '仅进行中的迭代可以完成');
  }
  const moved = await db
    .update(issues)
    .set({ sprintId: null })
    .where(
      and(
        eq(issues.companyId, actor.companyId),
        eq(issues.sprintId, id),
        notInArray(issues.status, ['done', 'canceled']),
      ),
    )
    .returning({ id: issues.id });
  await db.update(sprints).set({ status: 'completed' }).where(eq(sprints.id, id));
  const [row] = await attachProjectIds(actor.companyId, [
    (await db.select().from(sprints).where(eq(sprints.id, id)).limit(1))[0],
  ]);
  return { sprint: row, movedCount: moved.length };
}

/* ---- delete ---- (committed issues detach: sprintId → null) */
export async function deleteSprint(actor: Actor, id: string) {
  await requirePerm(actor, 'sprints', 'write');
  const [existing] = await db
    .select({ id: sprints.id })
    .from(sprints)
    .where(and(eq(sprints.companyId, actor.companyId), eq(sprints.id, id)))
    .limit(1);
  if (!existing) throw new ApiException('SPRINT_NOT_FOUND');
  // Explicit detach (the DB FK also has onDelete: 'set null'; doing it here keeps
  // the behavior independent of migration state). Issues keep their project.
  await db
    .update(issues)
    .set({ sprintId: null })
    .where(and(eq(issues.companyId, actor.companyId), eq(issues.sprintId, id)));
  await db.delete(sprints).where(eq(sprints.id, id));
  return { id };
}
