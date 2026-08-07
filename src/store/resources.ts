import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { InviteResourceInput } from '@/lib/api';
import type { AssignmentNodeType, AssignmentRole } from '@/lib/types';

/* PMS-2 资源池 + 虚拟团队 hooks. The pool ships in bootstrap (members carry
   origin/status), so invite/revoke invalidate ['bootstrap']. Per-node
   assignments are lazily queried; an assign/unassign touches a node's whole
   ancestor/descendant chain, so any mutation invalidates ['assignments'] wholesale
   (cheap — only mounted panels refetch) plus ['bootstrap'] for the pool view. */

function useInvalidatePool() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['bootstrap'] });
}
function useInvalidateAssignments() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['assignments'] });
    qc.invalidateQueries({ queryKey: ['bootstrap'] });
  };
}

/* ---- resource pool ---- */
export function useInviteResource() {
  const invalidate = useInvalidatePool();
  return useMutation({ mutationFn: (input: InviteResourceInput) => api.inviteResource(input), onSuccess: invalidate });
}
export function useRevokeResource() {
  const invalidate = useInvalidateAssignments();
  return useMutation({ mutationFn: (id: string) => api.revokeResource(id), onSuccess: invalidate });
}

/* ---- 公司席位(研发资源 · 内部成员段) ---- */
export function useSeats() {
  return useQuery({ queryKey: ['seats'], queryFn: () => api.seats() });
}
export function useUpdateSeatRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => api.updateSeatRole(id, role),
    // 角色变化影响 session 里的 permissions(若是本人)与席位列表。
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seats'] });
      qc.invalidateQueries({ queryKey: ['session'] });
    },
  });
}
export function useRemoveSeat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.removeSeat(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seats'] });
      qc.invalidateQueries({ queryKey: ['bootstrap'] });
    },
  });
}

/* ---- per-node virtual team ---- */
export function useNodeAssignments(nodeType: AssignmentNodeType, nodeId: string | null | undefined) {
  return useQuery({
    queryKey: ['assignments', nodeType, nodeId],
    queryFn: () => api.assignments(nodeType, nodeId as string),
    enabled: !!nodeId,
  });
}
/* Candidate members for assigning a specific issue — scoped to the issue's project
   (or sprint) research resources, plus AI agents. Used by the assignee pickers. */
export function useIssueCandidates(issueKey: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['assignments', 'issue-candidates', issueKey],
    queryFn: () => api.issueCandidates(issueKey as string),
    enabled: !!issueKey && enabled,
  });
}
export function useAssignCandidates(nodeType: AssignmentNodeType, nodeId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['assignments', 'candidates', nodeType, nodeId],
    queryFn: () => api.assignCandidates(nodeType, nodeId as string),
    enabled: !!nodeId && enabled,
  });
}
export function useCascadeImpact(
  nodeType: AssignmentNodeType,
  nodeId: string | null | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ['assignments', 'impact', nodeType, nodeId],
    queryFn: () => api.cascadeImpact(nodeType, nodeId as string),
    enabled: !!nodeId && enabled,
  });
}

export function useAssign() {
  const invalidate = useInvalidateAssignments();
  return useMutation({
    mutationFn: (input: { nodeType: AssignmentNodeType; nodeId: string; memberId: string; role?: AssignmentRole }) =>
      api.assign(input),
    onSuccess: invalidate,
  });
}
export function useUnassign() {
  const invalidate = useInvalidateAssignments();
  return useMutation({
    mutationFn: ({ nodeType, nodeId, memberId }: { nodeType: AssignmentNodeType; nodeId: string; memberId: string }) =>
      api.unassign(nodeType, nodeId, memberId),
    onSuccess: invalidate,
  });
}
export function useSetAssignmentRole() {
  const invalidate = useInvalidateAssignments();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: AssignmentRole }) => api.setAssignmentRole(id, role),
    onSuccess: invalidate,
  });
}
