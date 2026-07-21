import { ok } from '@/lib/envelope';
import {
  createTestCase,
  listTestCases,
  type CreateTestCaseInput,
  type TestCaseStatus,
  type TestResult,
} from '@/server/services/testcases';
import { jsonBody, requireActor, route } from '@/server/http';

/* GET  /api/v1/pms/test-cases?project&requirement&status&result — list
   (requirement takes the display key "FR-N").
   POST /api/v1/pms/test-cases — create (auto TC-N key; author = current member). */
export const GET = route(async (req) => {
  await requireActor();
  const sp = req.nextUrl.searchParams;
  return ok(
    await listTestCases({
      project: sp.get('project') ?? undefined,
      requirement: sp.get('requirement') ?? undefined,
      status: (sp.get('status') as TestCaseStatus | null) ?? undefined,
      result: (sp.get('result') as TestResult | null) ?? undefined,
    }),
  );
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  return ok(await createTestCase(actor, await jsonBody<CreateTestCaseInput>(req)));
});
