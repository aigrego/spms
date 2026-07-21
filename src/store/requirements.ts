import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CreateRequirementInput, UpdateRequirementInput } from '@/lib/api';
import type { RequirementType } from '@/lib/types';

/* Requirements / PRD queries + mutations. The linked-issue counts are derived
   server-side, so requirement mutations and issue→requirement re-links both need
   to refresh the requirement list (see issues store invalidation). */

export function useAllRequirements() {
  return useQuery({ queryKey: ['requirements', {}], queryFn: () => api.requirements() });
}

export function useRequirements(params?: { project?: string; type?: RequirementType }) {
  return useQuery({
    queryKey: ['requirements', params ?? {}],
    queryFn: () => api.requirements(params),
  });
}

export function useRequirement(id: string | null) {
  return useQuery({
    queryKey: ['requirement', id],
    queryFn: () => api.requirement(id!),
    enabled: !!id,
  });
}

function useInvalidateRequirements() {
  const qc = useQueryClient();
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: ['requirements'] });
    if (id) qc.invalidateQueries({ queryKey: ['requirement', id] });
  };
}

export function useCreateRequirement() {
  const invalidate = useInvalidateRequirements();
  return useMutation({
    mutationFn: (input: CreateRequirementInput) => api.createRequirement(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateRequirement() {
  const invalidate = useInvalidateRequirements();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateRequirementInput }) =>
      api.updateRequirement(id, input),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
}

export function useDeleteRequirement() {
  const invalidate = useInvalidateRequirements();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteRequirement(id),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['issues'] });
    },
  });
}
