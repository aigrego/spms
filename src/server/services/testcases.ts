import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { testCases, projects, requirements } from '@/db/schema';
import { serializeTestCase } from '@/lib/serialize';
import { ApiException } from '@/lib/envelope';
import { nextKey } from '@/lib/keys';
import type { Actor } from './types';

/* Test cases (测试用例) business service — project-scoped, optionally validating
   a requirement. Ported from apps/spms-server/src/routes/testcases.ts (tenant
   scoping removed; TC-N key now via the counters table). Addressed by display
   `key` ("TC-N"), mirroring the issue/requirement contract. */

type TestCaseRow = typeof testCases.$inferSelect;
export type TestCaseStatus = TestCaseRow['status'];
export type TestResult = TestCaseRow['result'];
export type TestCasePriority = TestCaseRow['priority'];

const withRequirement = { requirement: { columns: { key: true } } } as const;

/* Resolve a requirement display key (FR-N / NFR-N) → internal uuid.
   undefined = provided but not found; null = unlinked. */
async function resolveRequirementId(key: string | null | undefined) {
  if (!key) return null;
  const [r] = await db
    .select({ id: requirements.id })
    .from(requirements)
    .where(eq(requirements.key, key))
    .limit(1);
  return r?.id ?? undefined;
}

async function findByKey(key: string) {
  return db.query.testCases.findFirst({ where: eq(testCases.key, key) });
}

/* ---- list (optionally by project / requirement(display key) / status / result) ---- */
export async function listTestCases(filter?: {
  project?: string;
  requirement?: string;
  status?: TestCaseStatus;
  result?: TestResult;
}) {
  const conds = [];
  if (filter?.project) conds.push(eq(testCases.projectId, filter.project));
  if (filter?.status) conds.push(eq(testCases.status, filter.status));
  if (filter?.result) conds.push(eq(testCases.result, filter.result));
  const rows = await db.query.testCases.findMany({
    where: conds.length ? and(...conds) : undefined,
    with: withRequirement,
    orderBy: [asc(testCases.position)],
  });
  // requirement filter is by display key → filter post-join.
  const filtered = filter?.requirement ? rows.filter((r) => r.requirement?.key === filter.requirement) : rows;
  return filtered.map(serializeTestCase);
}

/* ---- single test case. Missing → null ---- */
export async function getTestCase(key: string) {
  const row = await db.query.testCases.findFirst({
    where: eq(testCases.key, key),
    with: withRequirement,
  });
  return row ? serializeTestCase(row) : null;
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
  if (!input.title.trim()) throw new ApiException('VALIDATION_FAILED', '用例标题不能为空');
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!project) throw new ApiException('PROJECT_NOT_FOUND');
  const reqId = await resolveRequirementId(input.requirementId);
  if (reqId === undefined) {
    throw new ApiException('REQUIREMENT_NOT_FOUND', `需求 ${input.requirementId} 不存在`);
  }

  const id = crypto.randomUUID();
  const key = await nextKey('TC');
  await db.insert(testCases).values({
    id,
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
export async function updateTestCase(key: string, input: UpdateTestCaseInput) {
  const existing = await findByKey(key);
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
    const reqId = await resolveRequirementId(input.requirementId);
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
export async function deleteTestCase(key: string) {
  const existing = await findByKey(key);
  if (!existing) throw new ApiException('TEST_CASE_NOT_FOUND', `测试用例 ${key} 不存在`);
  await db.delete(testCases).where(eq(testCases.id, existing.id));
  return { id: key };
}
