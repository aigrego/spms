import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CreatePlanInput, UpdatePlanInput } from '@/lib/api';

/* Dev plan (开发计划) queries + mutations. Mirrors the testcases store. */

export function usePlans(params?: { project?: string }) {
  return useQuery({ queryKey: ['plans', params ?? {}], queryFn: () => api.plans(params) });
}

export function usePlan(id: string | null) {
  return useQuery({ queryKey: ['plan', id], queryFn: () => api.plan(id!), enabled: !!id });
}

function useInvalidatePlans() {
  const qc = useQueryClient();
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: ['plans'] });
    if (id) qc.invalidateQueries({ queryKey: ['plan', id] });
  };
}

export function useCreatePlan() {
  const invalidate = useInvalidatePlans();
  return useMutation({ mutationFn: (input: CreatePlanInput) => api.createPlan(input), onSuccess: () => invalidate() });
}

export function useUpdatePlan() {
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePlanInput }) => api.updatePlan(id, input),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
}

export function useDeletePlan() {
  const invalidate = useInvalidatePlans();
  return useMutation({ mutationFn: (id: string) => api.deletePlan(id), onSuccess: () => invalidate() });
}
