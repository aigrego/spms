import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CreateTestCaseInput, UpdateTestCaseInput } from '@/lib/api';
import type { TestCaseStatus, TestResult } from '@/lib/types';

/* Test case queries + mutations. Mirrors the requirements store. */

export function useTestCases(params?: {
  project?: string;
  requirement?: string;
  status?: TestCaseStatus;
  result?: TestResult;
}) {
  return useQuery({ queryKey: ['testcases', params ?? {}], queryFn: () => api.testCases(params) });
}

export function useTestCase(id: string | null) {
  return useQuery({ queryKey: ['testcase', id], queryFn: () => api.testCase(id!), enabled: !!id });
}

function useInvalidateTestCases() {
  const qc = useQueryClient();
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: ['testcases'] });
    if (id) qc.invalidateQueries({ queryKey: ['testcase', id] });
  };
}

export function useCreateTestCase() {
  const invalidate = useInvalidateTestCases();
  return useMutation({ mutationFn: (input: CreateTestCaseInput) => api.createTestCase(input), onSuccess: () => invalidate() });
}

export function useUpdateTestCase() {
  const invalidate = useInvalidateTestCases();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTestCaseInput }) => api.updateTestCase(id, input),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
}

export function useDeleteTestCase() {
  const invalidate = useInvalidateTestCases();
  return useMutation({ mutationFn: (id: string) => api.deleteTestCase(id), onSuccess: () => invalidate() });
}
