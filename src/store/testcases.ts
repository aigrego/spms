import { api } from '@/lib/api';
import type { CreateTestCaseInput, UpdateTestCaseInput } from '@/lib/api';
import type { TestCase } from '@/lib/types';
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
