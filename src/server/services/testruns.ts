import { and, asc, desc, eq, inArray, isNull, ne, notInArray, or } from 'drizzle-orm';
import { db } from '@/db';
import { issues, projects, releases, testCases, testRunItems, testRuns } from '@/db/schema';
import { serializeTestCase, serializeTestRun } from '@/lib/serialize';
import { ApiException } from '@/lib/envelope';
import { requirePerm } from '@/lib/permissions';
import { assertProjectWritable, clampAllowed, visibleSetsFor } from '@/lib/visibility';
import { archivedProjectIds, createIssue } from './issues';
import type { TestCaseCategory, TestResult } from './testcases';
import type { Actor } from './types';

/* Test runs (测试执行) business service — suite execution + the two gates that
   make test cases functional:
   1) issue 关单门禁 (TDD 最小闭环): testing → done 要求关联用例全部 passed;
   2) release 发布门禁: status → released 要求集成用例全部 passed。

   套件(scope)语义:projectId 单项目;releaseId 跨版本下所有项目。 */

export interface SuiteScope {
  projectId?: string;
  releaseId?: string;
}

const withLinks = {
  requirement: { columns: { key: true } },
  issue: { columns: { key: true } },
} as const;

const LIST_LIMIT = 100;

/* Projects directly under a release (local copy — catalog.ts 里的同名私有函数
   不能直接 import,否则与 catalog 的发布门禁形成循环依赖)。 */
async function projectIdsOfRelease(companyId: string, releaseId: string): Promise<string[]> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.companyId, companyId), eq(projects.releaseId, releaseId)));
  return rows.map((r) => r.id);
}

/* Validate the scope and expand it to concrete project ids (visibility-filtered).
   Exactly one of projectId / releaseId must be given. */
async function resolveScopeProjects(actor: Actor, scope: SuiteScope): Promise<string[]> {
  if (!scope.projectId && !scope.releaseId) {
    throw new ApiException('VALIDATION_FAILED', 'projectId 与 releaseId 必须二选一');
  }
  if (scope.projectId && scope.releaseId) {
    throw new ApiException('VALIDATION_FAILED', 'projectId 与 releaseId 不能同时传');
  }
  if (scope.projectId) {
    // 可见性 + 可写性校验(令牌白名单/指派范围外 403)。
    await assertProjectWritable(actor, scope.projectId);
    return [scope.projectId];
  }
  const [release] = await db
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.companyId, actor.companyId), eq(releases.id, scope.releaseId!)))
    .limit(1);
  if (!release) throw new ApiException('RELEASE_NOT_FOUND');
  let ids = await projectIdsOfRelease(actor.companyId, release.id);
  const visibleProjectIds = clampAllowed(actor, (await visibleSetsFor(actor))?.projectIds ?? null);
  if (visibleProjectIds) ids = ids.filter((id) => visibleProjectIds.includes(id));
  return ids;
}

/* ---- suite: the executable set for a scope + category (non-deprecated) ---- */
export async function listSuite(actor: Actor, scope: SuiteScope, category: TestCaseCategory) {
  await requirePerm(actor, 'testcases', 'read');
  const projectIds = await resolveScopeProjects(actor, scope);
  if (projectIds.length === 0) return [];
  const archived = await archivedProjectIds(actor.companyId);
  const rows = await db.query.testCases.findMany({
    where: and(
      eq(testCases.companyId, actor.companyId),
      inArray(testCases.projectId, projectIds),
      eq(testCases.category, category),
      ne(testCases.status, 'deprecated'),
      // drizzle 的 notInArray 遇空数组生成恒真条件,直接传入即可。
      notInArray(testCases.projectId, archived),
    ),
    with: withLinks,
    orderBy: [asc(testCases.position)],
    limit: 500,
  });
  return rows.map(serializeTestCase);
}

export interface RecordRunInput extends SuiteScope {
  category: TestCaseCategory;
  results: { key: string; result: TestResult; note?: string }[];
  note?: string;
  raiseBugs?: boolean;
}

/* ---- record a suite execution ----
   每条结果:更新 test_cases.result(draft → active,结果落地即视为启用),并写入
   test_runs / test_run_items 留痕。raiseBugs=true 时 failed 项自动生成 BUG。 */
export async function recordRun(actor: Actor, input: RecordRunInput) {
  await requirePerm(actor, 'testcases', 'write');
  if (!input.results.length) throw new ApiException('VALIDATION_FAILED', 'results 不能为空');
  const projectIds = await resolveScopeProjects(actor, input);

  // 逐条解析 + 校验(存在、类别匹配、属于套件范围、未废弃)。
  const keys = input.results.map((r) => r.key);
  const rows = await db.query.testCases.findMany({
    where: and(eq(testCases.companyId, actor.companyId), inArray(testCases.key, keys)),
    with: withLinks,
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const r of input.results) {
    const tc = byKey.get(r.key);
    if (!tc) throw new ApiException('TEST_CASE_NOT_FOUND', `测试用例 ${r.key} 不存在`);
    if (tc.category !== input.category) {
      throw new ApiException('VALIDATION_FAILED', `测试用例 ${r.key} 的类别是 ${tc.category},不属于 ${input.category} 套件`);
    }
    if (!projectIds.includes(tc.projectId)) {
      throw new ApiException('VALIDATION_FAILED', `测试用例 ${r.key} 不在本次执行范围内`);
    }
    if (tc.status === 'deprecated') {
      throw new ApiException('VALIDATION_FAILED', `测试用例 ${r.key} 已废弃,不能执行`);
    }
  }

  const now = new Date();
  const summary = {
    total: input.results.length,
    passed: input.results.filter((r) => r.result === 'passed').length,
    failed: input.results.filter((r) => r.result === 'failed').length,
    blocked: input.results.filter((r) => r.result === 'blocked').length,
  };
  const runId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    for (const r of input.results) {
      const tc = byKey.get(r.key)!;
      await tx
        .update(testCases)
        .set({
          result: r.result,
          // 结果落地即视为启用:draft 推进为 active(deprecated 已在上面拦截)。
          ...(tc.status === 'draft' ? { status: 'active' as const } : {}),
          updatedAt: now,
        })
        .where(eq(testCases.id, tc.id));
    }
    await tx.insert(testRuns).values({
      id: runId,
      companyId: actor.companyId,
      projectId: input.projectId ?? null,
      releaseId: input.releaseId ?? null,
      category: input.category,
      executorId: actor.memberId,
      ...summary,
      note: input.note ?? null,
    });
    await tx.insert(testRunItems).values(
      input.results.map((r) => ({
        runId,
        testCaseId: byKey.get(r.key)!.id,
        result: r.result,
        note: r.note ?? null,
      })),
    );
  });

  // failed → 自动建 BUG(显式开关;在事务外走 issue service,保证活动流一致)。
  const bugs: { key: string; testCase: string }[] = [];
  if (input.raiseBugs) {
    for (const r of input.results) {
      if (r.result !== 'failed') continue;
      const tc = byKey.get(r.key)!;
      const bug = await createIssue(actor, {
        type: 'bug',
        title: `【测试失败】${tc.title}`,
        description:
          `测试用例 ${tc.key} 在 ${input.category} 套件执行中失败。` + (r.note?.trim() ? `\n\n失败备注:${r.note.trim()}` : ''),
        projectId: tc.projectId,
        requirementId: tc.requirement?.key ?? null,
        priority: 'high',
      });
      bugs.push({ key: bug.id, testCase: tc.key });
    }
  }

  const run = await db.query.testRuns.findFirst({
    where: eq(testRuns.id, runId),
    with: { items: { with: { testCase: { columns: { key: true } } } } },
  });
  return { run: serializeTestRun(run!), bugs };
}

/* ---- run history ---- */
export async function listTestRuns(
  actor: Actor,
  filter?: { project?: string; category?: TestCaseCategory },
) {
  await requirePerm(actor, 'testcases', 'read');
  const conds = [eq(testRuns.companyId, actor.companyId)];
  if (filter?.project) conds.push(eq(testRuns.projectId, filter.project));
  if (filter?.category) conds.push(eq(testRuns.category, filter.category));
  // 可见性:项目级执行按可见项目过滤;版本级执行(projectId 为 null)对公司内可见。
  const visibleProjectIds = clampAllowed(actor, (await visibleSetsFor(actor))?.projectIds ?? null);
  if (visibleProjectIds) {
    conds.push(or(inArray(testRuns.projectId, visibleProjectIds), isNull(testRuns.projectId))!);
  }
  const rows = await db.query.testRuns.findMany({
    where: and(...conds),
    with: { items: { with: { testCase: { columns: { key: true } } } } },
    orderBy: [desc(testRuns.createdAt)],
    limit: LIST_LIMIT,
  });
  return rows.map(serializeTestRun);
}

/* ------------------------------------------------------------------ */
/* Gates (内部辅助,不再校验权限 —— 调用方已走过各自 service 的权限检查)      */
/* ------------------------------------------------------------------ */

export interface BlockingCase {
  key: string;
  title: string;
  category: TestCaseCategory;
  result: TestResult;
}

function toBlocking(rows: { key: string; title: string; category: TestCaseCategory; result: TestResult }[]): BlockingCase[] {
  return rows.map((r) => ({ key: r.key, title: r.title, category: r.category, result: r.result }));
}

/* issue 关单门禁:直接挂该 issue 的全部用例 ∪ 挂其需求的 functional 用例
   (排除 deprecated)中,所有未 passed 的用例。返回空数组 = 可关单。 */
export async function blockingCasesForIssue(actor: Actor, issueKey: string): Promise<BlockingCase[]> {
  const [issue] = await db
    .select({ id: issues.id, requirementId: issues.requirementId })
    .from(issues)
    .where(and(eq(issues.companyId, actor.companyId), eq(issues.key, issueKey)))
    .limit(1);
  if (!issue) throw new ApiException('ISSUE_NOT_FOUND', `Issue ${issueKey} 不存在`);
  const linkCond = issue.requirementId
    ? or(
        eq(testCases.issueId, issue.id),
        and(eq(testCases.requirementId, issue.requirementId), eq(testCases.category, 'functional')),
      )
    : eq(testCases.issueId, issue.id);
  const rows = await db
    .select({ key: testCases.key, title: testCases.title, category: testCases.category, result: testCases.result })
    .from(testCases)
    .where(
      and(
        eq(testCases.companyId, actor.companyId),
        linkCond,
        ne(testCases.status, 'deprecated'),
        ne(testCases.result, 'passed'),
      ),
    );
  return toBlocking(rows);
}

/* release 发布门禁:版本下所有项目的 integration 用例(排除 deprecated)中
   所有未 passed 的用例。返回空数组 = 可发布。 */
export async function blockingIntegrationForRelease(actor: Actor, releaseId: string): Promise<BlockingCase[]> {
  const projectIds = await projectIdsOfRelease(actor.companyId, releaseId);
  if (projectIds.length === 0) return [];
  const rows = await db
    .select({ key: testCases.key, title: testCases.title, category: testCases.category, result: testCases.result })
    .from(testCases)
    .where(
      and(
        eq(testCases.companyId, actor.companyId),
        inArray(testCases.projectId, projectIds),
        eq(testCases.category, 'integration'),
        ne(testCases.status, 'deprecated'),
        ne(testCases.result, 'passed'),
      ),
    );
  return toBlocking(rows);
}

/* 门禁失败的统一报错文案。 */
export function testsNotPassedError(context: string, blocking: BlockingCase[]) {
  const list = blocking.map((c) => `${c.key}(${c.category}/${c.result}) ${c.title}`).join(';');
  return new ApiException(
    'TESTS_NOT_PASSED',
    `${context}:还有 ${blocking.length} 条关联测试用例未通过——${list}。请先执行并通过这些用例,或显式传 force=true 强制继续。`,
  );
}
