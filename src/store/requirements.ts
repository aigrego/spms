import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CreateRequirementInput, UpdateRequirementInput } from '@/lib/api';
import type { Requirement } from '@/lib/types';
import { createEntityHooks } from './createEntityHooks';

/* Requirements / PRD queries + mutations, built by the shared entity-hooks
   factory. The linked-issue counts are derived server-side, so requirement
   delete and issue→requirement re-links both need to refresh the issue list
   (delete here; issue-side invalidation lives in the factory's
   CROSS_ENTITY_KEYS). */

const requirementHooks = createEntityHooks<
  Parameters<typeof api.requirements>[0],
  Requirement,
  Requirement | null,
  CreateRequirementInput,
  UpdateRequirementInput
>({
  keys: { list: 'requirements', detail: 'requirement' },
  api: {
    list: api.requirements,
    detail: api.requirement,
    create: api.createRequirement,
    update: api.updateRequirement,
    remove: api.deleteRequirement,
  },
});

export const useRequirements = requirementHooks.useList;
export const useRequirement = requirementHooks.useDetail;
export const useCreateRequirement = requirementHooks.useCreate;
export const useUpdateRequirement = requirementHooks.useUpdate;

/* Same cache key and fetch as useRequirements() with no params. */
export function useAllRequirements() {
  return useRequirements();
}

/* Deleting a requirement only unlinks its issues (no cascade), so the issue
   lists showing linked-requirement info need a refresh; the backlog is not
   affected (status/sprint of the issues stay unchanged). */
export function useDeleteRequirement() {
  const invalidate = requirementHooks.useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteRequirement(id),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['issues'] });
    },
  });
}

export function useDecomposeRequirement() {
  const invalidate = requirementHooks.useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.decomposeRequirement(id),
    onSuccess: (_d, id) => {
      invalidate(id);
      qc.invalidateQueries({ queryKey: ['issues'] });
      // Decomposed issues are todo + sprint-less → they join the product backlog.
      qc.invalidateQueries({ queryKey: ['backlog'] });
    },
  });
}
