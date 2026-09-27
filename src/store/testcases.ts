import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CreateTestCaseInput, RecordTestRunInput, UpdateTestCaseInput } from '@/lib/api';
import type { TestCase, TestCaseCategory } from '@/lib/types';
import { createEntityHooks } from './createEntityHooks';

/* Test case queries + mutations, built by the shared entity-hooks factory. */

const testCaseHooks = createEntityHooks<
  Parameters<typeof api.testCases>[0],
  TestCase,
  TestCase | null,
  CreateTestCaseInput,
  UpdateTestCaseInput
>({
  keys: { list: 'testcases', detail: 'testcase' },
  api: {
    list: api.testCases,
    detail: api.testCase,
    create: api.createTestCase,
    update: api.updateTestCase,
    remove: api.deleteTestCase,
  },
});

export const useTestCases = testCaseHooks.useList;
export const useTestCase = testCaseHooks.useDetail;
export const useCreateTestCase = testCaseHooks.useCreate;
export const useUpdateTestCase = testCaseHooks.useUpdate;
export const useDeleteTestCase = testCaseHooks.useDelete;

/* ---- test runs (套件执行留痕) ----
   不走实体工厂:只有 list + record,没有 detail/update/delete 全族。 */

export function useTestRuns(params?: { project?: string; category?: TestCaseCategory }) {
  return useQuery({ queryKey: ['testruns', params ?? {}], queryFn: () => api.testRuns(params) });
}

export function useRecordTestRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordTestRunInput) => api.recordTestRun(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['testruns'] });
      // 执行会批量改写用例 result(draft 用例同时推进为 active)。
      qc.invalidateQueries({ queryKey: ['testcases'] });
      qc.invalidateQueries({ queryKey: ['testcase'] });
      // raiseBugs=true 时 failed 项自动建 BUG issue。
      qc.invalidateQueries({ queryKey: ['issues'] });
    },
  });
}
