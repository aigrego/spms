import { and, desc, eq, gte, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { issues, issueLabels, subIssues, activities, members, projects, requirements, sprints, sprintProjects } from '@/db/schema';
import { serializeIssueList, serializeIssueDetail } from '@/lib/serialize';
import { ApiException } from '@/lib/envelope';
import { nextKey } from '@/lib/keys';
import { assertProjectWritable, clampAllowed, issueVisible, visibleSetsFor } from '@/lib/visibility';
import { onAgentAssigned } from '@/lib/agents';
import { requirePerm } from '@/lib/permissions';
import { recordSprintSnapshot } from './sprintSnapshots';
import type { Actor } from './types';

/* Issue business service. Ported from apps/spms-server/src/routes/issues.ts —
   same rules, minus tenant scoping / portal notifications. Shared by the REST
   routes (Phase B2) and the MCP tools (Phase D).

   Multi-company: every function takes the Actor and reads/writes strictly
   inside actor.companyId; keys (BUG-N) are unique per company. Module gate:
   `issues` read/write. */

const withRelations = {
  issueLabels: { with: { label: true } },
  subIssues: true,
  requirement: { columns: { key: true } },
} as const;

type IssueRow = typeof issues.$inferSelect;
export type IssueStatus = IssueRow['status'];
export type IssuePriority = IssueRow['priority'];
export type IssueImportance = IssueRow['importance'];
export type IssueType = IssueRow['type'];

// Issue 类型 → display-key prefix (scoped to type, each with its own sequence).
// Matches docs/PLAN.md §keys + the blueprint (BLG/TKT/BUG).
const TYPE_PREFIX: Record<IssueType, string> = { backlog: 'BLG', ticket: 'TKT', bug: 'BUG' };

/* 列表服务端上限(口径同 reports.ts 的 LIST_LIMIT=500,此处放宽到 1000):
   前端「全部 Issues」视图依赖接近全量的列表,上限只作内存保护;超出按 key
   倒序截断(最新的优先返回),不加分页参数、不改响应形状。 */
const LIST_LIMIT = 1000;

/* Resolve a requirement display key ("FR-12") → its internal uuid, within the
   company. Returns null for an empty key; undefined when provided but not found. */
async function resolveRequirementId(companyId: string, key: string | null | undefined) {
  if (!key) return null;
  const [r] = await db
    .select({ id: requirements.id })
    .from(requirements)
    .where(and(eq(requirements.companyId, companyId), eq(requirements.key, key)))
    .limit(1);
  return r?.id ?? undefined;
}

/* Resolve an issue by its display key → the internal row, within the company. */
async function findByKey(companyId: string, key: string) {
  return db.query.issues.findFirst({ where: and(eq(issues.companyId, companyId), eq(issues.key, key)) });
}

const fetchDetail = (id: string) =>
  db.query.issues.findFirst({
    where: eq(issues.id, id),
    with: { ...withRelations, activities: true, attachments: true },
  });

/* 批量回读多条 issue 详情(批量创建场景的统一回读,避免逐条 fetchDetail 的
   N+1);返回顺序与入参 id 顺序一致。 */
export async function fetchIssueDetails(ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.query.issues.findMany({
    where: inArray(issues.id, ids),
    with: { ...withRelations, activities: true, attachments: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => serializeIssueDetail(byId.get(id)!));
}

/* Load any member (human or agent) by id, within the company. */
async function loadMember(companyId: string, memberId: string | null | undefined) {
  if (!memberId) return null;
  const [m] = await db
    .select({ id: members.id, type: members.type, agentKey: members.agentKey, name: members.name, userId: members.userId })
    .from(members)
    .where(and(eq(members.companyId, companyId), eq(members.id, memberId)))
    .limit(1);
  return m ?? null;
}

/* The (legacy) team a new issue inherits — derived from its project, for residual
   sprint/team filtering. Null when the issue isn't tied to a project. */
async function teamForProject(companyId: string, projectId: string | null) {
  if (!projectId) return null;
  const [p] = await db
    .select({ teamId: projects.teamId })
    .from(projects)
    .where(and(eq(projects.companyId, companyId), eq(projects.id, projectId)))
    .limit(1);
  return p?.teamId ?? null;
}

/* §4.3 consistency: a sprint spans one or more projects (sprint_projects) —
   the issue's project must be one of them (explicit conflicts are rejected);
   a project-less issue adopts the project only when the sprint has exactly
   one (multi-project sprints leave it company-scoped). Returns the resolved
   projectId. Throws SPRINT_NOT_FOUND / LIFECYCLE_MISMATCH. */
async function resolveSprintProject(
  companyId: string,
  sprintId: string,
  projectId: string | null,
): Promise<string | null> {
  const [sp] = await db
    .select({ id: sprints.id })
    .from(sprints)
    .where(and(eq(sprints.companyId, companyId), eq(sprints.id, sprintId)))
    .limit(1);
  if (!sp) throw new ApiException('SPRINT_NOT_FOUND', '迭代不存在');
  const projIds = (
    await db
      .select({ projectId: sprintProjects.projectId })
      .from(sprintProjects)
      .where(and(eq(sprintProjects.companyId, companyId), eq(sprintProjects.sprintId, sprintId)))
  ).map((r) => r.projectId);
  if (projIds.length > 0) {
    if (projectId && !projIds.includes(projectId)) throw new ApiException('LIFECYCLE_MISMATCH');
    if (projectId) return projectId;
    return projIds.length === 1 ? projIds[0] : null;
  }
  return projectId;
}

/* ---- list (optionally filtered by team / assignee / project) ---- */
export async function listIssues(
  actor: Actor,
  filter?: { team?: string; assignee?: string; project?: string; includeArchived?: boolean; recentDoneOnly?: boolean },
) {
  await requirePerm(actor, 'issues', 'read');
  const conds = [eq(issues.companyId, actor.companyId)];
  if (filter?.team) conds.push(eq(issues.teamId, filter.team));
  if (filter?.assignee) conds.push(eq(issues.assigneeId, filter.assignee));
  if (filter?.project) conds.push(eq(issues.projectId, filter.project));
  // 令牌项目白名单：只看得到白名单内的项目（无项目的 Issue 也不可见）。
  if (actor.allowedProjectIds) conds.push(inArray(issues.projectId, actor.allowedProjectIds));
  // 指派可见性：仅可见项目的 Issue 可见;无项目(projectId NULL)的 Issue 视为
  // 公司级,不过滤。与白名单条件并存(AND = 交集)。
  const visibleProjectIds = clampAllowed(actor, (await visibleSetsFor(actor))?.projectIds ?? null);
  if (visibleProjectIds) {
    conds.push(or(isNull(issues.projectId), inArray(issues.projectId, visibleProjectIds))!);
  }
  // 归档:默认排除已归档 issue 及归属已归档项目的 issue(includeArchived 放行,
  // 供「全部 Issues」的显示开关与项目中心的历史上下文)。
  if (!filter?.includeArchived) {
    conds.push(isNull(issues.archivedAt));
    conds.push(or(isNull(issues.projectId), notInArray(issues.projectId, await archivedProjectIds(actor.companyId)))!);
  }
  // 已完成(done)只保留最近一周的记录(按 completedAt 完成时间):opt-in,仅全部/
  // 我的 Issues 视图由路由层传 recentDone=1 开启;MCP 与其他消费方不传,拿全量。
  if (filter?.recentDoneOnly) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    conds.push(or(ne(issues.status, 'done'), gte(issues.completedAt, weekAgo))!);
  }
  const rows = await db.query.issues.findMany({
    where: and(...conds),
    with: withRelations,
    // 展示顺序固定为展示 ID 倒序(尾号数字降序,数字相同按 key 降序),
    // 不随创建/修改时间漂移 —— 列表位置稳定可预期。
    // 注意:模板串里的正则必须写成 \\d(JS 会把 \d 吞成字面 d)。
    // TODO(perf): 正则 cast 无法走索引,排序仍是全表 sort;LIMIT 只兜内存。
    // 后续优化点:key 尾号生成列 + 表达式索引(需迁移,TKT-21 未引入)。
    orderBy: [
      sql`case when ${issues.key} ~ '\\d+$' then cast(substring(${issues.key} from '\\d+$') as integer) else 0 end desc`,
      desc(issues.key),
    ],
    limit: LIST_LIMIT,
  });
  return rows.map(serializeIssueList);
}

/* 本公司已归档项目的 id 集(归档项目 = 其 issue 的批量归档)。
   供 listIssues / getBacklog 的归档排除共用。 */
export async function archivedProjectIds(companyId: string): Promise<string[]> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.companyId, companyId), sql`${projects.archivedAt} is not null`));
  return rows.map((r) => r.id);
}

/* 读单条按「不存在」处理（写路径 create/update 换项目则显式 403）:
   可见性判定统一由 @/lib/visibility 的 issueVisible / assertProjectWritable 提供。 */

/* ---- single issue with sub-issues + activity feed ----
   Missing data is NOT an error; the service returns null (route → data: null). */
export async function getIssue(actor: Actor, key: string) {
  await requirePerm(actor, 'issues', 'read');
  const row = await findByKey(actor.companyId, key);
  if (!row || !(await issueVisible(actor, row.projectId))) return null;
  const detail = await fetchDetail(row.id);
  return detail ? serializeIssueDetail(detail) : null;
}

export interface CreateIssueInput {
  title: string;
  /* 自定义展示 key(如 Notion 同步过来的 "CRM-518");缺省按类型自动分配
     BUG-/TKT-/BLG-。公司内已存在 → CONFLICT。 */
  key?: string;
  description?: string | null;
  type?: IssueType;
  status?: IssueStatus;
  priority?: IssuePriority;
  importance?: IssueImportance;
  assigneeId?: string | null;
  projectId?: string | null;
  requirementId?: string | null; // display key ("FR-N"), not the internal uuid
  sprintId?: string | null;
  estimate?: number | null;
  storyPoints?: number | null;
  labels?: string[]; // label ids — full replacement set
}

/* ---- create ----
   opts.deferDetail: 跳过结尾的详情回读,只返回 { id, key }(内部 uuid + 展示 key)
   —— 批量创建场景(decomposeRequirement)由调用方最后用 fetchIssueDetails 统一回读。 */
export async function createIssue(
  actor: Actor,
  input: CreateIssueInput,
): Promise<ReturnType<typeof serializeIssueDetail>>;
export async function createIssue(
  actor: Actor,
  input: CreateIssueInput,
  opts: { deferDetail: true },
): Promise<{ id: string; key: string }>;
export async function createIssue(actor: Actor, input: CreateIssueInput, opts?: { deferDetail?: boolean }) {
  await requirePerm(actor, 'issues', 'write');
  if (!input.title.trim()) throw new ApiException('VALIDATION_FAILED', '标题不能为空');
  const companyId = actor.companyId;

  const assigneeMember = await loadMember(companyId, input.assigneeId);
  const agent = assigneeMember?.type === 'agent' ? assigneeMember : null;

  // Resolve the requirement display key → internal uuid (null if unlinked).
  const reqId = await resolveRequirementId(companyId, input.requirementId);
  if (reqId === undefined) {
    throw new ApiException('REQUIREMENT_NOT_FOUND', `需求 ${input.requirementId} 不存在`);
  }

  // §4.3 sprint-project consistency.
  let resolvedProjectId = input.projectId ?? null;
  if (input.sprintId) {
    resolvedProjectId = await resolveSprintProject(companyId, input.sprintId, resolvedProjectId);
  }
  // 令牌项目白名单：只能在白名单项目内创建。
  await assertProjectWritable(actor, resolvedProjectId);

  // Legacy team inherited from the project (team is retired from the UI).
  const teamId = await teamForProject(companyId, resolvedProjectId);

  // Allocate the display key: caller-supplied (must be free within the company)
  // or the next per-type key (BUG-/TKT-/BLG-).
  const issueType = input.type ?? 'ticket';
  const id = crypto.randomUUID();
  const customKey = input.key?.trim();
  if (customKey) {
    if (customKey.length > 64) throw new ApiException('VALIDATION_FAILED', 'key 过长(≤64)');
    const clash = await findByKey(companyId, customKey);
    if (clash) throw new ApiException('CONFLICT', `key ${customKey} 已存在`);
  }
  const key = customKey || (await nextKey(companyId, TYPE_PREFIX[issueType]));
  // issue 行 + 标签 + created 动态同生同灭 → 一个事务。nextKey 保持事务外:
  // 计数器行锁若带进事务会串行化同类创建,回遗留号空洞可接受(与序列语义一致)。
  await db.transaction(async (tx) => {
    await tx.insert(issues).values({
      id,
      companyId,
      key,
      teamId,
      title: input.title.trim(),
      description: input.description ?? null,
      type: issueType,
      status: input.status ?? 'todo',
      completedAt: input.status === 'done' ? new Date() : null,
      priority: input.priority ?? 'none',
      importance: input.importance ?? 'none',
      assigneeId: input.assigneeId ?? null,
      projectId: resolvedProjectId,
      requirementId: reqId,
      sprintId: input.sprintId ?? null,
      estimate: input.estimate ?? null,
      storyPoints: input.storyPoints ?? null,
      aiAssigned: !!agent,
    });

    if (input.labels?.length) {
      await tx
        .insert(issueLabels)
        .values(input.labels.map((labelId) => ({ companyId, issueId: id, labelId })))
        .onConflictDoNothing();
    }
    await tx.insert(activities).values({
      id: crypto.randomUUID(),
      companyId,
      issueId: id,
      whoId: actor.memberId,
      kind: 'created',
      body: '创建了该 Issue',
    });
  });

  // Agent assignee → label + scripted AI task. Human assignee on create: the
  // blueprint only sent a portal notification; with no portal, nothing extra
  // is written (the `created` activity already records it).
  // onAgentAssigned / recordSprintSnapshot 是外部 helper(内部用全局 db,且依赖
  // 已提交的 issue 行),保持事务后执行;失败留下的是可补偿的缺漏(少剧本/少快照),
  // 而非半截 issue。
  if (agent) await onAgentAssigned(companyId, id, agent);

  // 直接建进迭代的 issue 影响当日燃尽快照。
  if (input.sprintId) await recordSprintSnapshot(companyId, input.sprintId);

  if (opts?.deferDetail) return { id, key };
  const row = await fetchDetail(id);
  return serializeIssueDetail(row!);
}

export interface UpdateIssueInput {
  title?: string;
  description?: string | null;
  type?: IssueType;
  status?: IssueStatus;
  priority?: IssuePriority;
  importance?: IssueImportance;
  assigneeId?: string | null;
  projectId?: string | null;
  requirementId?: string | null; // display key
  sprintId?: string | null;
  estimate?: number | null;
  storyPoints?: number | null;
  labels?: string[]; // full replacement when provided
}

/* ---- update (partial) ---- */
export async function updateIssue(actor: Actor, key: string, input: UpdateIssueInput) {
  await requirePerm(actor, 'issues', 'write');
  const companyId = actor.companyId;
  const existing = await findByKey(companyId, key);
  if (!existing) throw new ApiException('ISSUE_NOT_FOUND', `Issue ${key} 不存在`);
  // 令牌项目白名单 + 指派可见性：范围外的 Issue 按不存在处理，且不能改入范围外项目。
  if (!(await issueVisible(actor, existing.projectId))) {
    throw new ApiException('ISSUE_NOT_FOUND', `Issue ${key} 不存在`);
  }

  let newAgent: { id: string; agentKey: string | null; name: string } | null = null;
  let newHumanName: string | null = null;
  const patch: Partial<typeof issues.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.type !== undefined) patch.type = input.type;
  if (input.status !== undefined) {
    patch.status = input.status;
    // 完成时间:进入 done 写入,离开 done 清空(重开后再完成取最新时刻)。
    if (input.status === 'done' && existing.status !== 'done') patch.completedAt = new Date();
    else if (input.status !== 'done' && existing.status === 'done') patch.completedAt = null;
  }
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.importance !== undefined) patch.importance = input.importance;
  if (input.projectId !== undefined) patch.projectId = input.projectId;
  if (input.requirementId !== undefined) {
    const reqId = await resolveRequirementId(companyId, input.requirementId);
    if (reqId === undefined) {
      throw new ApiException('REQUIREMENT_NOT_FOUND', `需求 ${input.requirementId} 不存在`);
    }
    patch.requirementId = reqId;
  }
  if (input.sprintId !== undefined) patch.sprintId = input.sprintId;
  // §4.3 consistency: only re-validate when the update itself touches the
  // sprint/project link. Unrelated edits (status, title, …) must not be
  // blocked by a pre-existing mismatch (e.g. the sprint's projects were
  // edited after the issue entered it).
  if (input.sprintId !== undefined || input.projectId !== undefined) {
    const nextSprintId = input.sprintId !== undefined ? input.sprintId : existing.sprintId;
    if (nextSprintId) {
      const effProject = input.projectId !== undefined ? input.projectId : existing.projectId;
      patch.projectId = await resolveSprintProject(companyId, nextSprintId, effProject ?? null);
    }
  }
  if (patch.projectId !== undefined) await assertProjectWritable(actor, patch.projectId ?? null);
  // Keep the legacy teamId aligned with the issue's (possibly changed) project.
  if (patch.projectId !== undefined) {
    patch.teamId = await teamForProject(companyId, patch.projectId ?? null);
  }
  if (input.estimate !== undefined) patch.estimate = input.estimate;
  if (input.storyPoints !== undefined) patch.storyPoints = input.storyPoints;
  if (input.assigneeId !== undefined) {
    patch.assigneeId = input.assigneeId;
    const m = await loadMember(companyId, input.assigneeId);
    patch.aiAssigned = m?.type === 'agent';
    // Fire the per-recipient flow only when the assignment actually changed hands.
    if (m && existing.assigneeId !== input.assigneeId) {
      if (m.type === 'agent') newAgent = m;
      else newHumanName = m.name;
    }
  }

  await db.update(issues).set(patch).where(eq(issues.id, existing.id));

  // 状态/故事点/所属迭代变化会改变燃尽剩余点数 →  upsert 当日快照;
  // 换迭代时旧迭代也要补一记。
  if (input.status !== undefined || input.storyPoints !== undefined || input.sprintId !== undefined) {
    const nextSprintId = input.sprintId !== undefined ? input.sprintId : existing.sprintId;
    if (existing.sprintId && existing.sprintId !== nextSprintId) {
      await recordSprintSnapshot(companyId, existing.sprintId);
    }
    await recordSprintSnapshot(companyId, nextSprintId);
  }

  // Record the status transition in the activity feed (the activity_kind enum
  // has 'status' but neither the blueprint nor the port ever wrote it — the
  // MCP contract expects status changes to be traceable in the feed).
  if (input.status !== undefined && input.status !== existing.status) {
    await db.insert(activities).values({
      id: crypto.randomUUID(),
      companyId,
      issueId: existing.id,
      whoId: actor.memberId,
      kind: 'status',
      body: `状态变更为 ${input.status}`,
    });
  }

  if (input.labels !== undefined) {
    // 全量替换 = 先删后插,必须同事务:中途失败不能留下"标签被清空"的半截状态。
    const labelIds = input.labels;
    await db.transaction(async (tx) => {
      await tx.delete(issueLabels).where(eq(issueLabels.issueId, existing.id));
      if (labelIds.length) {
        await tx
          .insert(issueLabels)
          .values(labelIds.map((labelId) => ({ companyId, issueId: existing.id, labelId })))
          .onConflictDoNothing();
      }
    });
  }

  if (newAgent) {
    await onAgentAssigned(companyId, existing.id, newAgent);
  } else if (newHumanName) {
    // Record the (re)assignment in the issue's activity feed (the blueprint
    // also sent a portal notification — dropped in the rewrite).
    await db.insert(activities).values({
      id: crypto.randomUUID(),
      companyId,
      issueId: existing.id,
      whoId: actor.memberId,
      kind: 'assign',
      body: `指派给 ${newHumanName}`,
    });
  }

  const row = await fetchDetail(existing.id);
  return serializeIssueDetail(row!);
}

/* ---- delete ---- */
export async function deleteIssue(actor: Actor, key: string) {
  await requirePerm(actor, 'issues', 'write');
  const existing = await findByKey(actor.companyId, key);
  if (!existing) throw new ApiException('ISSUE_NOT_FOUND', `Issue ${key} 不存在`);
  // 令牌项目白名单 + 指派可见性：范围外的 Issue 按不存在处理（与 updateIssue 一致）。
  if (!(await issueVisible(actor, existing.projectId))) {
    throw new ApiException('ISSUE_NOT_FOUND', `Issue ${key} 不存在`);
  }
  await db.delete(issues).where(eq(issues.id, existing.id));
  if (existing.sprintId) await recordSprintSnapshot(actor.companyId, existing.sprintId);
  return { id: key };
}

/* ---- archive / unarchive ----
   归档只影响可见性(全部 Issues/产品待办默认隐藏),不做只读约束;迭代详情、
   项目中心等历史上下文仍可见。 */
export async function archiveIssue(actor: Actor, key: string, archived: boolean) {
  await requirePerm(actor, 'issues', 'write');
  const existing = await findByKey(actor.companyId, key);
  if (!existing || !(await issueVisible(actor, existing.projectId))) {
    throw new ApiException('ISSUE_NOT_FOUND', `Issue ${key} 不存在`);
  }
  await db
    .update(issues)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(eq(issues.id, existing.id));
  await db.insert(activities).values({
    id: crypto.randomUUID(),
    companyId: actor.companyId,
    issueId: existing.id,
    whoId: actor.memberId,
    kind: 'status',
    body: archived ? '归档了该 Issue' : '取消了归档',
  });
  return { id: key, archived };
}

/* ---- add a comment (creates an activity + bumps comment count) ---- */
export async function addComment(actor: Actor, key: string, body: string) {
  await requirePerm(actor, 'issues', 'write');
  const existing = await findByKey(actor.companyId, key);
  if (!existing) throw new ApiException('ISSUE_NOT_FOUND', `Issue ${key} 不存在`);
  // 令牌项目白名单 + 指派可见性：范围外的 Issue 按不存在处理（与 updateIssue 一致）。
  if (!(await issueVisible(actor, existing.projectId))) {
    throw new ApiException('ISSUE_NOT_FOUND', `Issue ${key} 不存在`);
  }
  if (!body.trim()) throw new ApiException('VALIDATION_FAILED', '评论内容不能为空');
  const id = crypto.randomUUID();
  // 评论动态与 commentsCount+1 必须同生同灭 → 一个事务。
  await db.transaction(async (tx) => {
    await tx.insert(activities).values({
      id,
      companyId: actor.companyId,
      issueId: existing.id,
      whoId: actor.memberId,
      kind: 'comment',
      body: body.trim(),
    });
    await tx
      .update(issues)
      .set({ commentsCount: sql`${issues.commentsCount} + 1`, updatedAt: new Date() })
      .where(eq(issues.id, existing.id));
  });
  return { id };
}

/* ---- toggle a sub-issue's done state ----
   The sub is addressed by its own id; the URL 中的 issue key 必须与 sub 的
   父 issue 一致且父 issue 在可见范围内,否则一律按子任务不存在处理。 */
export async function toggleSubIssue(actor: Actor, key: string, subId: string, status: IssueStatus) {
  await requirePerm(actor, 'issues', 'write');
  const sub = await db.query.subIssues.findFirst({
    where: and(eq(subIssues.companyId, actor.companyId), eq(subIssues.id, subId)),
  });
  if (!sub) throw new ApiException('NOT_FOUND', `子任务 ${subId} 不存在`);
  // 校验 sub 归属 URL 中的父 issue(key 一致),并对父 issue 项目做可见性检查。
  const parent = await db.query.issues.findFirst({
    where: and(eq(issues.companyId, actor.companyId), eq(issues.id, sub.issueId)),
  });
  if (!parent || parent.key !== key || !(await issueVisible(actor, parent.projectId))) {
    throw new ApiException('NOT_FOUND', `子任务 ${subId} 不存在`);
  }
  await db.update(subIssues).set({ status }).where(eq(subIssues.id, subId));
  await db.update(issues).set({ updatedAt: new Date() }).where(eq(issues.id, sub.issueId));
  return { id: subId, status };
}
