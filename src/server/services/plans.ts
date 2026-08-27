import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '@/db';
import { plans, planRequirements, projects, requirements } from '@/db/schema';
import { serializePlan } from '@/lib/serialize';
import { ApiException } from '@/lib/envelope';
import { nextKey } from '@/lib/keys';
import { requirePerm } from '@/lib/permissions';
import { assertProjectWritable, clampAllowed, issueVisible, visibleSetsFor } from '@/lib/visibility';
import { archivedProjectIds } from './issues';
import type { Actor } from './types';

/* Dev plans (开发计划) business service — project-scoped markdown documents
   linked to N requirements (plan_requirements join). Addressed by display
   `key` ("PLAN-N"), mirroring the test-case contract.

   Multi-company: every function takes the Actor and reads/writes strictly
   inside actor.companyId; keys (PLAN-N) are unique per company. Module gate:
   复用 `requirements` read/write(决策:不为开发计划新增 RBAC 模块)。 */

type PlanRow = typeof plans.$inferSelect;
export type PlanStatus = PlanRow['status'];

const withRequirements = {
  planRequirements: { with: { requirement: { columns: { key: true } } } },
} as const;

/* 列表服务端上限(与 testcases.ts 的 LIST_LIMIT=500 同口径)。 */
const LIST_LIMIT = 500;

/* Resolve requirement display keys (FR-N / NFR-N) → internal uuids, within the
   company. Unknown keys → VALIDATION_FAILED(创建不幂等,调用方需明确纠错)。 */
async function resolveRequirementIds(companyId: string, keys: string[]): Promise<string[]> {
  if (!keys.length) return [];
  const rows = await db
    .select({ id: requirements.id, key: requirements.key })
    .from(requirements)
    .where(and(eq(requirements.companyId, companyId), inArray(requirements.key, keys)));
  const byKey = new Map(rows.map((r) => [r.key, r.id]));
  const missing = keys.filter((k) => !byKey.has(k));
  if (missing.length) {
    throw new ApiException('VALIDATION_FAILED', `需求 ${missing.join('、')} 不存在`);
  }
  // 去重并保持调用方顺序。
  return [...new Set(keys)].map((k) => byKey.get(k)!);
}

async function findByKey(companyId: string, key: string) {
  return db.query.plans.findFirst({
    where: and(eq(plans.companyId, companyId), eq(plans.key, key)),
  });
}

/* ---- list (optionally by project uuid) ---- */
export async function listPlans(actor: Actor, filter?: { project?: string }) {
  await requirePerm(actor, 'requirements', 'read');
  const conds = [eq(plans.companyId, actor.companyId)];
  if (filter?.project) conds.push(eq(plans.projectId, filter.project));
  // 指派可见性 ∩ 令牌白名单(与 listTestCases 同款);null = 管理员不限制。
  const visibleProjectIds = clampAllowed(actor, (await visibleSetsFor(actor))?.projectIds ?? null);
  if (visibleProjectIds) conds.push(inArray(plans.projectId, visibleProjectIds));
  // 归档项目的批量隐藏:与列表默认行为一致(详情仍可直查,作历史上下文)。
  conds.push(notInArray(plans.projectId, await archivedProjectIds(actor.companyId)));
  const rows = await db.query.plans.findMany({
    where: and(...conds),
    with: withRequirements,
    orderBy: [desc(plans.createdAt)],
    limit: LIST_LIMIT,
  });
  return rows.map(serializePlan);
}

/* ---- single plan. Missing or outside the actor's visibility → null ---- */
export async function getPlan(actor: Actor, key: string) {
  await requirePerm(actor, 'requirements', 'read');
  const row = await db.query.plans.findFirst({
    where: and(eq(plans.companyId, actor.companyId), eq(plans.key, key)),
    with: withRequirements,
  });
  if (!row) return null;
  const visibleProjectIds = clampAllowed(actor, (await visibleSetsFor(actor))?.projectIds ?? null);
  if (visibleProjectIds && !visibleProjectIds.includes(row.projectId)) return null;
  return serializePlan(row);
}

export interface CreatePlanInput {
  projectId: string;
  title: string;
  requirementIds?: string[]; // display keys ("FR-N"), not internal uuids
  templateMd?: string;
}

/* ---- create (auto PLAN-N key) ---- */
export async function createPlan(actor: Actor, input: CreatePlanInput) {
  await requirePerm(actor, 'requirements', 'write');
  if (!input.title.trim()) throw new ApiException('VALIDATION_FAILED', '计划标题不能为空');
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.companyId, actor.companyId), eq(projects.id, input.projectId)))
    .limit(1);
  if (!project) throw new ApiException('PROJECT_NOT_FOUND');
  // 只能在可见项目内建计划(令牌白名单 + 指派可见性),范围外 403。
  await assertProjectWritable(actor, input.projectId);
  const reqIds = await resolveRequirementIds(actor.companyId, input.requirementIds ?? []);

  const id = crypto.randomUUID();
  const key = await nextKey(actor.companyId, 'PLAN');
  // 计划行 + 关联行同生同灭 → 一个事务。nextKey 保持事务外(与 issues.ts 同理)。
  await db.transaction(async (tx) => {
    await tx.insert(plans).values({
      id,
      companyId: actor.companyId,
      key,
      projectId: input.projectId,
      title: input.title.trim(),
      templateMd: input.templateMd ?? null,
      status: 'draft',
      authorId: actor.memberId,
    });
    if (reqIds.length) {
      await tx
        .insert(planRequirements)
        .values(reqIds.map((requirementId) => ({ companyId: actor.companyId, planId: id, requirementId })));
    }
  });

  const row = await db.query.plans.findFirst({
    where: eq(plans.id, id),
    with: withRequirements,
  });
  return serializePlan(row!);
}

export interface UpdatePlanInput {
  title?: string;
  content?: string;
  templateMd?: string | null;
  status?: PlanStatus;
  requirementIds?: string[]; // display keys; provided = 全量替换
}

/* ---- update (partial; requirementIds full-replace when provided) ---- */
export async function updatePlan(actor: Actor, key: string, input: UpdatePlanInput) {
  await requirePerm(actor, 'requirements', 'write');
  const existing = await findByKey(actor.companyId, key);
  if (!existing) throw new ApiException('PLAN_NOT_FOUND', `开发计划 ${key} 不存在`);
  // 可见性:范围外的计划按不存在处理(与 list/get 的过滤一致)。
  if (!(await issueVisible(actor, existing.projectId))) {
    throw new ApiException('PLAN_NOT_FOUND', `开发计划 ${key} 不存在`);
  }

  const patch: Partial<typeof plans.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.content !== undefined) patch.content = input.content;
  if (input.templateMd !== undefined) patch.templateMd = input.templateMd;
  if (input.status !== undefined) patch.status = input.status;

  const reqIds =
    input.requirementIds !== undefined
      ? await resolveRequirementIds(actor.companyId, input.requirementIds)
      : undefined;

  // 字段补丁 + 关联全量替换(先删后插)必须同事务:中途失败不能留下"关联被清空"
  // 的半截状态。
  await db.transaction(async (tx) => {
    await tx.update(plans).set(patch).where(eq(plans.id, existing.id));
    if (reqIds !== undefined) {
      await tx.delete(planRequirements).where(eq(planRequirements.planId, existing.id));
      if (reqIds.length) {
        await tx
          .insert(planRequirements)
          .values(reqIds.map((requirementId) => ({ companyId: actor.companyId, planId: existing.id, requirementId })));
      }
    }
  });

  const row = await db.query.plans.findFirst({
    where: eq(plans.id, existing.id),
    with: withRequirements,
  });
  return serializePlan(row!);
}

/* ---- delete ---- */
export async function deletePlan(actor: Actor, key: string) {
  await requirePerm(actor, 'requirements', 'write');
  const existing = await findByKey(actor.companyId, key);
  if (!existing) throw new ApiException('PLAN_NOT_FOUND', `开发计划 ${key} 不存在`);
  // 可见性:范围外的计划按不存在处理(与 list/get 的过滤一致)。
  if (!(await issueVisible(actor, existing.projectId))) {
    throw new ApiException('PLAN_NOT_FOUND', `开发计划 ${key} 不存在`);
  }
  await db.delete(plans).where(eq(plans.id, existing.id));
  return { id: key };
}
