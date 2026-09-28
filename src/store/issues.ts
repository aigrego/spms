import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AttachmentMeta, CreateIssueInput, UpdateIssueInput, Api } from '@/lib/api';
import type { Issue, IssueDetail } from '@/lib/types';
import { createEntityHooks } from './createEntityHooks';

/* Issue queries + mutations, built by the shared entity-hooks factory. The
   cross-entity invalidation list (requirements / sprint / burndown / velocity
   / backlog) is maintained centrally in the factory's CROSS_ENTITY_KEYS. */

const issueHooks = createEntityHooks<
  Parameters<typeof api.issues>[0],
  Issue,
  IssueDetail | null,
  CreateIssueInput,
  UpdateIssueInput
>({
  keys: { list: 'issues', detail: 'issue' },
  api: {
    list: api.issues,
    detail: api.issue,
    create: api.createIssue,
    update: api.updateIssue,
    remove: api.deleteIssue,
  },
});

/* Issue-list query. "My issues" passes the current user's member id (resolved
   from /bootstrap) as the assignee param. `enabled=false` suspends the query
   (my-issues waits for meId, avoiding a first request with no assignee). Same
   query key/queryFn as the factory's useList, so factory invalidation applies. */
export function useIssues(params?: Parameters<typeof api.issues>[0], enabled = true) {
  return useQuery({
    queryKey: ['issues', params ?? {}],
    queryFn: () => api.issues(params),
    enabled,
  });
}

export function useAllIssues(includeArchived = false) {
  return useQuery({
    queryKey: ['issues', { includeArchived }],
    queryFn: () => api.issues({ includeArchived }),
  });
}

export const useIssue = issueHooks.useDetail;
export const useCreateIssue = issueHooks.useCreate;
export const useUpdateIssue = issueHooks.useUpdate;
export const useDeleteIssue = issueHooks.useDelete;

const useInvalidateIssues = issueHooks.useInvalidate;

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

/* Attachments exist only on issues (api.registerAttachment takes an issue key;
   there is no requirement/testcase attachment endpoint), so these hooks stay
   here on the issue invalidator. */
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

/* BUG-17: 现场自定义标签。标签列表随 bootstrap 下发 → 只失效 bootstrap。 */
export function useCreateLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; color: string }) => api.createLabel(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bootstrap'] }),
  });
}

export type { Api };
