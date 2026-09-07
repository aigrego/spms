import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useSprints(team?: string) {
  return useQuery({ queryKey: ['sprints', team], queryFn: () => api.sprints(team) });
}

export function useBacklog(team?: string) {
  return useQuery({ queryKey: ['backlog', team], queryFn: () => api.backlog(team) });
}

export function useSprint(id: string | null) {
  return useQuery({
    queryKey: ['sprint', id],
    queryFn: () => api.sprint(id!),
    enabled: !!id,
  });
}

export function useBurndown(id: string | null) {
  return useQuery({
    queryKey: ['burndown', id],
    queryFn: () => api.burndown(id!),
    enabled: !!id,
  });
}

export function useVelocity(team?: string) {
  return useQuery({ queryKey: ['velocity', team], queryFn: () => api.velocity(team) });
}

/* Move an issue into a sprint (or '_backlog' to remove). Invalidates the
   backlog, sprint detail, burndown and velocity so all Scrum views refresh. */
export function useMoveIssueToSprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sprintId, issueId, storyPoints }: { sprintId: string; issueId: string; storyPoints?: number | null }) =>
      api.moveIssueToSprint(sprintId, issueId, storyPoints),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backlog'] });
      qc.invalidateQueries({ queryKey: ['sprint'] });
      qc.invalidateQueries({ queryKey: ['burndown'] });
      qc.invalidateQueries({ queryKey: ['velocity'] });
      qc.invalidateQueries({ queryKey: ['issues'] });
    },
  });
}

/* Sprint CRUD (sprints also ship in the bootstrap payload → invalidate it too). */
function useInvalidateSprints() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['bootstrap'] });
    qc.invalidateQueries({ queryKey: ['sprints'] });
    qc.invalidateQueries({ queryKey: ['sprint'] });
    qc.invalidateQueries({ queryKey: ['velocity'] });
  };
}

export function useCreateSprint() {
  const invalidate = useInvalidateSprints();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.createSprint>[0]) => api.createSprint(input),
    onSuccess: invalidate,
  });
}

export function useUpdateSprint() {
  const invalidate = useInvalidateSprints();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.updateSprint>[1] }) =>
      api.updateSprint(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteSprint() {
  const invalidate = useInvalidateSprints();
  return useMutation({
    mutationFn: (id: string) => api.deleteSprint(id),
    onSuccess: invalidate,
  });
}

/* Lifecycle: planned → active → completed. Completing also moves unfinished
   issues back to the backlog, so the backlog/burndown caches go too. */
function useInvalidateSprintLifecycle() {
  const qc = useQueryClient();
  const invalidate = useInvalidateSprints();
  return () => {
    invalidate();
    qc.invalidateQueries({ queryKey: ['backlog'] });
    qc.invalidateQueries({ queryKey: ['burndown'] });
  };
}

export function useStartSprint() {
  const invalidate = useInvalidateSprintLifecycle();
  return useMutation({
    mutationFn: (id: string) => api.startSprint(id),
    onSuccess: invalidate,
  });
}

export function useCompleteSprint() {
  const invalidate = useInvalidateSprintLifecycle();
  return useMutation({
    mutationFn: (id: string) => api.completeSprint(id),
    onSuccess: invalidate,
  });
}
