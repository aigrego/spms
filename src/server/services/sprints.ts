import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { sprints, sprintSnapshots, issues, projects } from '@/db/schema';
import { serializeIssueList } from '@/lib/serialize';
import { ApiException } from '@/lib/envelope';

/* Sprint business service. Ported from apps/spms-server/src/routes/sprints.ts
   (tenant scoping removed) — plus createSprint / updateSprint / deleteSprint,
   which the blueprint did not have (see report). Shared by routes + MCP. */

const withRelations = {
  issueLabels: { with: { label: true } },
  subIssues: true,
  requirement: { columns: { key: true } },
} as const;

const DONE_STATUSES = ['done', 'canceled'];

const sumPoints = (rows: { storyPoints: number | null }[]) =>
  rows.reduce((s, r) => s + (r.storyPoints ?? 0), 0);

type SprintRow = typeof sprints.$inferSelect;
export type SprintStatus = SprintRow['status'];

/* ---- list sprints (optionally by team), startDate asc ---- */
export async function listSprints(filter?: { team?: string }) {
  const conds = [];
  if (filter?.team) conds.push(eq(sprints.teamId, filter.team));
  return db
    .select()
    .from(sprints)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(sprints.startDate));
}

/* ---- product backlog: issues not committed to any sprint, backlogRank asc ---- */
export async function getBacklog(filter?: { team?: string }) {
  const conds = [isNull(issues.sprintId)];
  if (filter?.team) conds.push(eq(issues.teamId, filter.team));
  const rows = await db.query.issues.findMany({
    where: and(...conds),
    with: withRelations,
    orderBy: [asc(issues.backlogRank)],
  });
  return rows.map(serializeIssueList);
}

/* ---- velocity: completed points per sprint + avg over completed sprints ---- */
export async function getVelocity(filter?: { team?: string }) {
  const conds = [];
  if (filter?.team) conds.push(eq(sprints.teamId, filter.team));
  const sprintRows = await db
    .select()
    .from(sprints)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(sprints.startDate));

  const series = [];
  for (const s of sprintRows) {
    const rows = await db
      .select({ storyPoints: issues.storyPoints, status: issues.status })
      .from(issues)
      .where(eq(issues.sprintId, s.id));
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

/* ---- single sprint: meta + committed issues + computed stats. Missing → null ---- */
export async function getSprint(id: string) {
  const sprint = await db.query.sprints.findFirst({ where: eq(sprints.id, id) });
  if (!sprint) return null;

  const rows = await db.query.issues.findMany({
    where: eq(issues.sprintId, id),
    with: withRelations,
    orderBy: [asc(issues.backlogRank)],
  });
  const committedPoints = sumPoints(rows);
  const completedPoints = sumPoints(rows.filter((r) => r.status === 'done'));

  return {
    ...sprint,
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
   Missing sprint → null. ---- */
export async function getBurndown(id: string) {
  const sprint = await db.query.sprints.findFirst({ where: eq(sprints.id, id) });
  if (!sprint) return null;

  const committed = sumPoints(
    await db.select({ storyPoints: issues.storyPoints }).from(issues).where(eq(issues.sprintId, id)),
  );

  const snaps = await db
    .select()
    .from(sprintSnapshots)
    .where(eq(sprintSnapshots.sprintId, id))
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
   sprintId is a sprint id or '_backlog'. */
export async function moveIssue(sprintIdOrBacklog: string, issueKey: string, storyPoints?: number | null) {
  const issue = await db.query.issues.findFirst({ where: eq(issues.key, issueKey) });
  if (!issue) throw new ApiException('ISSUE_NOT_FOUND', `Issue ${issueKey} 不存在`);

  const targetSprint = sprintIdOrBacklog === '_backlog' ? null : sprintIdOrBacklog;
  const patch: Partial<typeof issues.$inferInsert> = { sprintId: targetSprint, updatedAt: new Date() };
  if (targetSprint) {
    const sprint = await db.query.sprints.findFirst({ where: eq(sprints.id, targetSprint) });
    if (!sprint) throw new ApiException('SPRINT_NOT_FOUND', `Sprint ${targetSprint} 不存在`);
    // PMS-2 §4.3: a sprint belongs to one project — the issue adopts it so the
    // range (project) and time-box (sprint) stay consistent.
    if (sprint.projectId) patch.projectId = sprint.projectId;
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

/* The legacy team a sprint inherits — derived from its project. */
async function teamForProject(projectId: string | null | undefined) {
  if (!projectId) return null;
  const [p] = await db
    .select({ teamId: projects.teamId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return p?.teamId ?? null;
}

async function projectExists(id: string) {
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
  return !!p;
}

export interface CreateSprintInput {
  name: string;
  goal?: string | null;
  status?: SprintStatus;
  startDate: Date | string;
  endDate: Date | string;
  capacity?: number | null;
  projectId?: string | null;
  teamId?: string | null; // legacy; derived from the project when not given
}

/* ---- create ---- */
export async function createSprint(input: CreateSprintInput) {
  if (!input.name.trim()) throw new ApiException('VALIDATION_FAILED', '迭代名称不能为空');
  if (input.startDate === undefined || input.endDate === undefined) {
    throw new ApiException('VALIDATION_FAILED', '迭代开始/结束日期必填');
  }
  const startDate = parseDate(input.startDate, 'startDate');
  const endDate = parseDate(input.endDate, 'endDate');
  if (+endDate < +startDate) throw new ApiException('VALIDATION_FAILED', '结束日期不能早于开始日期');
  if (input.projectId && !(await projectExists(input.projectId))) {
    throw new ApiException('PROJECT_NOT_FOUND');
  }

  const id = crypto.randomUUID();
  await db.insert(sprints).values({
    id,
    name: input.name.trim(),
    goal: input.goal ?? null,
    status: input.status ?? 'planned',
    startDate,
    endDate,
    capacity: input.capacity ?? null,
    projectId: input.projectId ?? null,
    teamId: input.teamId !== undefined ? input.teamId : await teamForProject(input.projectId),
  });
  const [row] = await db.select().from(sprints).where(eq(sprints.id, id)).limit(1);
  return row;
}

export interface UpdateSprintInput {
  name?: string;
  goal?: string | null;
  status?: SprintStatus;
  startDate?: Date | string;
  endDate?: Date | string;
  capacity?: number | null;
  projectId?: string | null;
  teamId?: string | null;
}

/* ---- update (partial) ---- */
export async function updateSprint(id: string, input: UpdateSprintInput) {
  const [existing] = await db.select().from(sprints).where(eq(sprints.id, id)).limit(1);
  if (!existing) throw new ApiException('SPRINT_NOT_FOUND');
  if (input.projectId && !(await projectExists(input.projectId))) {
    throw new ApiException('PROJECT_NOT_FOUND');
  }

  const patch: Partial<typeof sprints.$inferInsert> = {};
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new ApiException('VALIDATION_FAILED', '迭代名称不能为空');
    patch.name = input.name.trim();
  }
  if (input.goal !== undefined) patch.goal = input.goal;
  if (input.status !== undefined) patch.status = input.status;
  if (input.startDate !== undefined) patch.startDate = parseDate(input.startDate, 'startDate');
  if (input.endDate !== undefined) patch.endDate = parseDate(input.endDate, 'endDate');
  // Validate the effective date range when either side changes.
  const effStart = patch.startDate ?? existing.startDate;
  const effEnd = patch.endDate ?? existing.endDate;
  if (+effEnd < +effStart) throw new ApiException('VALIDATION_FAILED', '结束日期不能早于开始日期');
  if (input.capacity !== undefined) patch.capacity = input.capacity;
  if (input.projectId !== undefined) {
    patch.projectId = input.projectId;
    // Keep the legacy teamId aligned unless explicitly overridden.
    if (input.teamId === undefined) patch.teamId = await teamForProject(input.projectId);
  }
  if (input.teamId !== undefined) patch.teamId = input.teamId;

  await db.update(sprints).set(patch).where(eq(sprints.id, id));
  const [row] = await db.select().from(sprints).where(eq(sprints.id, id)).limit(1);
  return row;
}

/* ---- delete ---- (committed issues detach: sprintId → null) */
export async function deleteSprint(id: string) {
  const [existing] = await db.select({ id: sprints.id }).from(sprints).where(eq(sprints.id, id)).limit(1);
  if (!existing) throw new ApiException('SPRINT_NOT_FOUND');
  // Explicit detach (the DB FK also has onDelete: 'set null'; doing it here keeps
  // the behavior independent of migration state). Issues keep their project.
  await db.update(issues).set({ sprintId: null }).where(eq(issues.sprintId, id));
  await db.delete(sprints).where(eq(sprints.id, id));
  return { id };
}
