import { ok } from '@/lib/envelope';
import { listTestRuns, recordRun } from '@/server/services/testruns';
import type { TestCaseCategory } from '@/server/services/testcases';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, testRunCreateSchema } from '@/server/validate';

/* GET  /api/v1/pms/test-runs?project&category — 执行历史(倒序,含明细)。
   POST /api/v1/pms/test-runs — 记录一次套件执行(projectId 与 releaseId 二选一);
   逐条更新用例 result 并留痕 test_runs/test_run_items;raiseBugs=true 时 failed
   项自动生成 BUG。 */
export const GET = route(async (req) => {
  const actor = await requireActor();
  const sp = req.nextUrl.searchParams;
  return ok(
    await listTestRuns(actor, {
      project: sp.get('project') ?? undefined,
      category: (sp.get('category') as TestCaseCategory | null) ?? undefined,
    }),
  );
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  return ok(await recordRun(actor, await jsonBodyWith(req, testRunCreateSchema)));
});
