import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ProjectInput } from '@/lib/api';

/* Project mutations. Projects ship in the bootstrap payload, so every mutation
   invalidates ['bootstrap']; delete also detaches issues, so refresh those too. */

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['bootstrap'] });
    qc.invalidateQueries({ queryKey: ['issues'] });
    qc.invalidateQueries({ queryKey: ['requirements'] });
  };
}

export function useCreateProject() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (input: ProjectInput) => api.createProject(input), onSuccess: invalidate });
}

export function useUpdateProject() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<ProjectInput> }) => api.updateProject(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteProject() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => api.deleteProject(id), onSuccess: invalidate });
}

export function useArchiveProject() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => api.archiveProject(id, archived),
    onSuccess: invalidate,
  });
}
