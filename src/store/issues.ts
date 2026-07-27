import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AttachmentMeta, CreateIssueInput, UpdateIssueInput, Api } from '@/lib/api';

/* Issue-list query. "My issues" passes the current user's member id (resolved
   from /bootstrap) as the assignee param. */
export function useIssues(params?: { team?: string; assignee?: string; project?: string; includeArchived?: boolean; recentDone?: boolean }) {
  return useQuery({
    queryKey: ['issues', params ?? {}],
    queryFn: () => api.issues(params),
  });
}

export function useAllIssues(includeArchived = false) {
  return useQuery({
    queryKey: ['issues', { includeArchived }],
    queryFn: () => api.issues({ includeArchived }),
  });
}

export function useIssue(id: string | null) {
  return useQuery({
    queryKey: ['issue', id],
    queryFn: () => api.issue(id!),
    enabled: !!id,
  });
}

function useInvalidateIssues() {
  const qc = useQueryClient();
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: ['issues'] });
    if (id) qc.invalidateQueries({ queryKey: ['issue', id] });
    // An issue's requirement link affects requirement issue-counts/lists.
    qc.invalidateQueries({ queryKey: ['requirements'] });
    qc.invalidateQueries({ queryKey: ['requirement'] });
  };
}

export function useCreateIssue() {
  const invalidate = useInvalidateIssues();
  return useMutation({
    mutationFn: (input: CreateIssueInput) => api.createIssue(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateIssue() {
  const invalidate = useInvalidateIssues();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateIssueInput }) => api.updateIssue(id, input),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
}

export function useDeleteIssue() {
  const invalidate = useInvalidateIssues();
  return useMutation({
    mutationFn: (id: string) => api.deleteIssue(id),
    onSuccess: () => invalidate(),
  });
}

export function useArchiveIssue() {
  const invalidate = useInvalidateIssues();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => api.archiveIssue(id, archived),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
}

export function useAddComment() {
  const invalidate = useInvalidateIssues();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api.addComment(id, body),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
}

export function useToggleSub() {
  const invalidate = useInvalidateIssues();
  return useMutation({
    mutationFn: ({ id, subId, status }: { id: string; subId: string; status: 'done' | 'todo' }) =>
      api.toggleSub(id, subId, status),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
}

export function useRegisterAttachment() {
  const invalidate = useInvalidateIssues();
  return useMutation({
    mutationFn: ({ id, meta }: { id: string; meta: AttachmentMeta }) => api.registerAttachment(id, meta),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
}

export function useDeleteAttachment() {
  const invalidate = useInvalidateIssues();
  return useMutation({
    mutationFn: ({ attachmentId }: { id: string; attachmentId: string }) =>
      api.deleteAttachment(attachmentId),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
}

export type { Api };
