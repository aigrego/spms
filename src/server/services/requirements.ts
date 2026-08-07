import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '@/db';
import { requirements, projects } from '@/db/schema';
import { serializeRequirement } from '@/lib/serialize';
import { ApiException } from '@/lib/envelope';
import { nextKey } from '@/lib/keys';
import { requirePerm } from '@/lib/permissions';
import { assertProjectWritable, clampAllowed, issueVisible, visibleSetsFor } from '@/lib/visibility';
import { decompositionItemsFor } from '@/lib/decompose';
import { archivedProjectIds, createIssue, fetchIssueDetails } from './issues';
import type { Actor } from './types';

/* Requirements / PRD business service. Ported from
   apps/spms-server/src/routes/requirements.ts. A requirement is scoped to a
   project, typed functional vs non_functional (with an NFR category), and is
   decomposed into issues (issues.requirementId). Addressed by display `key`
   (functional → "FR-N", non-functional → "NFR-N"), mirroring the issue key
   contract.

   Multi-company: every function takes the Actor and reads/writes strictly
   inside actor.companyId; keys are unique per company. Module gate:
   `requirements` read/write. */

type RequirementRow = typeof requirements.$inferSelect;
export type RequirementType = RequirementRow['type'];
export type RequirementCategory = RequirementRow['category'];
export type RequirementStatus = RequirementRow['status'];
export type RequirementPriority = RequirementRow['priority'];
export type RequirementImportance = RequirementRow['importance'];

const withIssues = { issues: { columns: { key: true, status: true } } } as const;

/* 列表服务端上限(与 reports.ts 的 LIST_LIMIT=500 同口径):内存保护,
   超出按 position 截断;不加分页参数、不改响应形状。 */
const LIST_LIMIT = 500;

async function findByKey(companyId: string, key: string) {
  return db.query.requirements.findFirst({
    where: and(eq(requirements.companyId, companyId), eq(requirements.key, key)),
  });
}

/* ---- list (optionally filtered by project / type), position asc ---- */
export async function listRequirements(actor: Actor, filter?: { project?: string; type?: RequirementType }) {
  await requirePerm(actor, 'requirements', 'read');
  const conds = [eq(requirements.companyId, actor.companyId)];
  if (filter?.project) conds.push(eq(requirements.projectId, filter.project));
  if (filter?.type) conds.push(eq(requirements.type, filter.type));
  // 指派可见性 ∩ 令牌白名单(与 listIssues 同款);null = 管理员不限制。
  const visibleProjectIds = clampAllowed(actor, (await visibleSetsFor(actor))?.projectIds ?? null);
  if (visibleProjectIds) conds.push(inArray(requirements.projectId, visibleProjectIds));
  // 归档项目的批量隐藏:与 listIssues 默认行为一致(详情仍可直查,作历史上下文)。
  conds.push(notInArray(requirements.projectId, await archivedProjectIds(actor.companyId)));
  const rows = await db.query.requirements.findMany({
    where: and(...conds),
    with: withIssues,
    orderBy: [asc(requirements.position)],
    limit: LIST_LIMIT,
  });
  return rows.map(serializeRequirement);
}

/* ---- single requirement (+ linked issue keys). Missing or outside the
   actor's visibility → null ---- */
export async function getRequirement(actor: Actor, key: string) {
  await requirePerm(actor, 'requirements', 'read');
  const row = await db.query.requirements.findFirst({
    where: and(eq(requirements.companyId, actor.companyId), eq(requirements.key, key)),
    with: withIssues,
  });
  if (!row) return null;
  const visibleProjectIds = clampAllowed(actor, (await visibleSetsFor(actor))?.projectIds ?? null);
  if (visibleProjectIds && !visibleProjectIds.includes(row.projectId)) return null;
  return serializeRequirement(row);
}

export interface CreateRequirementInput {
  projectId: string;
  title: string;
  type?: RequirementType;
  category?: RequirementCategory;
  priority?: RequirementPriority;
  importance?: RequirementImportance;
  status?: RequirementStatus;
  description?: string | null;
  acceptanceCriteria?: string | null;
  releaseId?: string | null;
  aiOwnerId?: string | null;
  position?: number;
}

/* ---- create (auto FR-N / NFR-N key per type) ---- */
export async function createRequirement(actor: Actor, input: CreateRequirementInput) {
  await requirePerm(actor, 'requirements', 'write');
  if (!input.title.trim()) throw new ApiException('VALIDATION_FAILED', '需求标题不能为空');
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.companyId, actor.companyId), eq(projects.id, input.projectId)))
    .limit(1);
  if (!project) throw new ApiException('PROJECT_NOT_FOUND');
  // 只能在可见项目内建需求(令牌白名单 + 指派可见性),范围外 403。
  await assertProjectWritable(actor, input.projectId);

  // Key prefix reflects the type: functional → FR-N, non-functional → NFR-N,
  // each with its own sequence. The key is the stable identifier (issues link by
  // it) — it's fixed at creation and not rewritten if the type later changes,
  // mirroring the issue-key contract.
  const type = input.type ?? 'functional';
  const id = crypto.randomUUID();
  const key = await nextKey(actor.companyId, type === 'non_functional' ? 'NFR' : 'FR');
  await db.insert(requirements).values({
    id,
    companyId: actor.companyId,
    key,
    projectId: input.projectId,
    title: input.title.trim(),
    type,
    // Only meaningful for non_functional requirements; null for functional ones.
    category: type === 'non_functional' ? (input.category ?? null) : null,
    priority: input.priority ?? 'none',
    importance: input.importance ?? 'none',
    status: input.status ?? 'draft',
    description: input.description ?? null,
    acceptanceCriteria: input.acceptanceCriteria ?? null,
    releaseId: input.releaseId ?? null,
    authorId: actor.memberId,
    aiOwnerId: input.aiOwnerId ?? null,
    position: input.position ?? 0,
  });

  const row = await db.query.requirements.findFirst({
    where: eq(requirements.id, id),
    with: withIssues,
  });
  return serializeRequirement(row!);
}

export interface UpdateRequirementInput {
  projectId?: string;
  title?: string;
  type?: RequirementType;
  category?: RequirementCategory;
  priority?: RequirementPriority;
  importance?: RequirementImportance;
  status?: RequirementStatus;
  description?: string | null;
  acceptanceCriteria?: string | null;
  releaseId?: string | null;
  aiOwnerId?: string | null;
  position?: number;
}

/* ---- update (partial) ---- */
export async function updateRequirement(actor: Actor, key: string, input: UpdateRequirementInput) {
  await requirePerm(actor, 'requirements', 'write');
  const existing = await findByKey(actor.companyId, key);
  if (!existing) throw new ApiException('REQUIREMENT_NOT_FOUND', `需求 ${key} 不存在`);
  // 可见性:范围外的需求按不存在处理(与 list/get 的过滤一致)。
  if (!(await issueVisible(actor, existing.projectId))) {
    throw new ApiException('REQUIREMENT_NOT_FOUND', `需求 ${key} 不存在`);
  }
  // 改入新项目时,目标项目也必须在可见范围内,范围外 403。
  if (input.projectId !== undefined) await assertProjectWritable(actor, input.projectId);

  const patch: Partial<typeof requirements.$inferInsert> = { updatedAt: new Date() };
  if (input.projectId !== undefined) patch.projectId = input.projectId;
  if (input.title !== undefined) patch.title = input.title;
  if (input.type !== undefined) patch.type = input.type;
  if (input.category !== undefined) patch.category = input.category;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.importance !== undefined) patch.importance = input.importance;
  if (input.status !== undefined) patch.status = input.status;
  if (input.description !== undefined) patch.description = input.description;
  if (input.acceptanceCriteria !== undefined) patch.acceptanceCriteria = input.acceptanceCriteria;
  if (input.releaseId !== undefined) patch.releaseId = input.releaseId;
  if (input.aiOwnerId !== undefined) patch.aiOwnerId = input.aiOwnerId;
  if (input.position !== undefined) patch.position = input.position;
  // Clearing the type to functional drops any NFR category.
  if (input.type === 'functional') patch.category = null;

  await db.update(requirements).set(patch).where(eq(requirements.id, existing.id));

  const row = await db.query.requirements.findFirst({
    where: eq(requirements.id, existing.id),
    with: withIssues,
  });
  return serializeRequirement(row!);
}

/* ---- delete (hard delete; referencing issues' requirementId is set null by
   the DB FK onDelete rule) ---- */
export async function deleteRequirement(actor: Actor, key: string) {
  await requirePerm(actor, 'requirements', 'write');
  const existing = await findByKey(actor.companyId, key);
  if (!existing) throw new ApiException('REQUIREMENT_NOT_FOUND', `需求 ${key} 不存在`);
  // 可见性:范围外的需求按不存在处理(与 list/get 的过滤一致)。
  if (!(await issueVisible(actor, existing.projectId))) {
    throw new ApiException('REQUIREMENT_NOT_FOUND', `需求 ${key} 不存在`);
  }
  await db.delete(requirements).where(eq(requirements.id, existing.id));
  return { id: key };
}

/* ---- decompose into issues: split acceptance criteria lines (fallback: PRD
   description lines) into ticket issues linked back to this requirement,
   inheriting its project / priority / importance. Capped by
   DECOMPOSE_MAX_ITEMS; nothing to split → VALIDATION_FAILED. ---- */
export async function decomposeRequirement(actor: Actor, key: string) {
  await requirePerm(actor, 'requirements', 'write');
  const existing = await findByKey(actor.companyId, key);
  if (!existing) throw new ApiException('REQUIREMENT_NOT_FOUND', `需求 ${key} 不存在`);

  const items = decompositionItemsFor(existing);
  if (items.length === 0) {
    throw new ApiException('VALIDATION_FAILED', '该需求的验收标准和描述均为空，没有可拆分的内容');
  }

  // createIssue enforces the issues-write perm and the project whitelist per item.
  // 逐条创建保留 createIssue 的编号/事务语义;deferDetail 跳过逐条详情回读,
  // 最后一条 inArray 统一批量取回(原为每条一次 fetchDetail,N+1)。
  const refs: { id: string; key: string }[] = [];
  for (const title of items) {
    refs.push(
      await createIssue(
        actor,
        {
          title,
          type: 'ticket',
          projectId: existing.projectId,
          requirementId: key,
          priority: existing.priority,
          importance: existing.importance,
        },
        { deferDetail: true },
      ),
    );
  }
  return fetchIssueDetails(refs.map((r) => r.id));
}
