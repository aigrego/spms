import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '@/db';
import { testCases, projects, requirements } from '@/db/schema';
import { serializeTestCase } from '@/lib/serialize';
import { ApiException } from '@/lib/envelope';
import { nextKey } from '@/lib/keys';
import { requirePerm } from '@/lib/permissions';
import { clampAllowed, visibleSetsFor } from '@/lib/visibility';
import { archivedProjectIds } from './issues';
import type { Actor } from './types';

/* Test cases (测试用例) business service — project-scoped, optionally validating
   a requirement. Ported from apps/spms-server/src/routes/testcases.ts (TC-N key
   via the counters table). Addressed by display `key` ("TC-N"), mirroring the
   issue/requirement contract.

   Multi-company: every function takes the Actor and reads/writes strictly
   inside actor.companyId; keys (TC-N) are unique per company. Module gate:
   `testcases` read/write. */

type TestCaseRow = typeof testCases.$inferSelect;
export type TestCaseStatus = TestCaseRow['status'];
export type TestResult = TestCaseRow['result'];
export type TestCasePriority = TestCaseRow['priority'];

const withRequirement = { requirement: { columns: { key: true } } } as const;

/* Resolve a requirement display key (FR-N / NFR-N) → internal uuid, within the
   company. undefined = provided but not found; null = unlinked. */
async function resolveRequirementId(companyId: string, key: string | null | undefined) {
  if (!key) return null;
  const [r] = await db
    .select({ id: requirements.id })
    .from(requirements)
    .where(and(eq(requirements.companyId, companyId), eq(requirements.key, key)))
    .limit(1);
  return r?.id ?? undefined;
}

async function findByKey(companyId: string, key: string) {
  return db.query.testCases.findFirst({ where: and(eq(testCases.companyId, companyId), eq(testCases.key, key)) });
}

/* ---- list (optionally by project / requirement(display key) / status / result) ---- */
export async function listTestCases(
  actor: Actor,
  filter?: {
    project?: string;
    requirement?: string;
    status?: TestCaseStatus;
    result?: TestResult;
  },
) {
  await requirePerm(actor, 'testcases', 'read');
  const conds = [eq(testCases.companyId, actor.companyId)];
  if (filter?.project) conds.push(eq(testCases.projectId, filter.project));
  if (filter?.status) conds.push(eq(testCases.status, filter.status));
  if (filter?.result) conds.push(eq(testCases.result, filter.result));
  // 指派可见性 ∩ 令牌白名单(与 listIssues 同款);null = 管理员不限制。
  const visibleProjectIds = clampAllowed(actor, (await visibleSetsFor(actor))?.projectIds ?? null);
  if (visibleProjectIds) conds.push(inArray(testCases.projectId, visibleProjectIds));
  // 归档项目的批量隐藏:与 listIssues 默认行为一致(详情仍可直查,作历史上下文)。
  conds.push(notInArray(testCases.projectId, await archivedProjectIds(actor.companyId)));
  const rows = await db.query.testCases.findMany({
    where: and(...conds),
    with: withRequirement,
    orderBy: [asc(testCases.position)],
  });
  // requirement filter is by display key → filter post-join.
  const filtered = filter?.requirement ? rows.filter((r) => r.requirement?.key === filter.requirement) : rows;
  return filtered.map(serializeTestCase);
}

/* ---- single test case. Missing or outside the actor's visibility → null ---- */
export async function getTestCase(actor: Actor, key: string) {
  await requirePerm(actor, 'testcases', 'read');
  const row = await db.query.testCases.findFirst({
    where: and(eq(testCases.companyId, actor.companyId), eq(testCases.key, key)),
    with: withRequirement,
  });
  if (!row) return null;
  const visibleProjectIds = clampAllowed(actor, (await visibleSetsFor(actor))?.projectIds ?? null);
  if (visibleProjectIds && !visibleProjectIds.includes(row.projectId)) return null;
  return serializeTestCase(row);
}

export interface CreateTestCaseInput {
  projectId: string;
  requirementId?: string | null; // display key ("FR-N"), not the internal uuid
  title: string;
  priority?: TestCasePriority;
  status?: TestCaseStatus;
  result?: TestResult;
  preconditions?: string | null;
  steps?: string | null;
  expected?: string | null;
  assigneeId?: string | null;
  position?: number;
}

/* ---- create (auto TC-N key) ---- */
export async function createTestCase(actor: Actor, input: CreateTestCaseInput) {
  await requirePerm(actor, 'testcases', 'write');
  if (!input.title.trim()) throw new ApiException('VALIDATION_FAILED', '用例标题不能为空');
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.companyId, actor.companyId), eq(projects.id, input.projectId)))
    .limit(1);
  if (!project) throw new ApiException('PROJECT_NOT_FOUND');
  const reqId = await resolveRequirementId(actor.companyId, input.requirementId);
  if (reqId === undefined) {
    throw new ApiException('REQUIREMENT_NOT_FOUND', `需求 ${input.requirementId} 不存在`);
  }

  const id = crypto.randomUUID();
  const key = await nextKey(actor.companyId, 'TC');
  await db.insert(testCases).values({
    id,
    companyId: actor.companyId,
    key,
    projectId: input.projectId,
    requirementId: reqId,
    title: input.title.trim(),
    priority: input.priority ?? 'none',
    status: input.status ?? 'draft',
    result: input.result ?? 'untested',
    preconditions: input.preconditions ?? null,
    steps: input.steps ?? null,
    expected: input.expected ?? null,
    authorId: actor.memberId,
    assigneeId: input.assigneeId ?? null,
    position: input.position ?? 0,
  });

  const row = await db.query.testCases.findFirst({
    where: eq(testCases.id, id),
    with: withRequirement,
  });
  return serializeTestCase(row!);
}

export interface UpdateTestCaseInput {
  projectId?: string;
  requirementId?: string | null; // display key
  title?: string;
  priority?: TestCasePriority;
  status?: TestCaseStatus;
  result?: TestResult;
  preconditions?: string | null;
  steps?: string | null;
  expected?: string | null;
  assigneeId?: string | null;
  position?: number;
}

/* ---- update (partial) ---- */
export async function updateTestCase(actor: Actor, key: string, input: UpdateTestCaseInput) {
  await requirePerm(actor, 'testcases', 'write');
  const existing = await findByKey(actor.companyId, key);
  if (!existing) throw new ApiException('TEST_CASE_NOT_FOUND', `测试用例 ${key} 不存在`);

  const patch: Partial<typeof testCases.$inferInsert> = { updatedAt: new Date() };
  if (input.projectId !== undefined) patch.projectId = input.projectId;
  if (input.title !== undefined) patch.title = input.title;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.status !== undefined) patch.status = input.status;
  if (input.result !== undefined) patch.result = input.result;
  if (input.preconditions !== undefined) patch.preconditions = input.preconditions;
  if (input.steps !== undefined) patch.steps = input.steps;
  if (input.expected !== undefined) patch.expected = input.expected;
  if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId;
  if (input.position !== undefined) patch.position = input.position;
  if (input.requirementId !== undefined) {
    const reqId = await resolveRequirementId(actor.companyId, input.requirementId);
    if (reqId === undefined) {
      throw new ApiException('REQUIREMENT_NOT_FOUND', `需求 ${input.requirementId} 不存在`);
    }
    patch.requirementId = reqId;
  }

  await db.update(testCases).set(patch).where(eq(testCases.id, existing.id));
  const row = await db.query.testCases.findFirst({
    where: eq(testCases.id, existing.id),
    with: withRequirement,
  });
  return serializeTestCase(row!);
}

/* ---- delete ---- */
export async function deleteTestCase(actor: Actor, key: string) {
  await requirePerm(actor, 'testcases', 'write');
  const existing = await findByKey(actor.companyId, key);
  if (!existing) throw new ApiException('TEST_CASE_NOT_FOUND', `测试用例 ${key} 不存在`);
  await db.delete(testCases).where(eq(testCases.id, existing.id));
  return { id: key };
}
