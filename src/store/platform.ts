import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformApi } from '@/lib/platformApi';
import type { AddMemberInput, CompanyRole, CreateCompanyInput, PermLevel } from '@/lib/platformApi';

/* Platform admin React Query hooks. All platform data lives under the
   ['platform', ...] key tree; mutations invalidate their subtree only —
   business data (bootstrap/issues/…) is untouched except by enterCompany,
   which wipes the whole cache before the caller navigates into the sandbox. */

export const platformKeys = {
  all: ['platform'] as const,
  companies: () => [...platformKeys.all, 'companies'] as const,
  members: (companyId: string) => [...platformKeys.all, 'members', companyId] as const,
  matrix: () => [...platformKeys.all, 'permissions-matrix'] as const,
  mcpKeys: () => [...platformKeys.all, 'mcp-keys'] as const,
};

/* ---- companies ---- */
export function useCompanies() {
  return useQuery({ queryKey: platformKeys.companies(), queryFn: () => platformApi.companies() });
}

export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCompanyInput) => platformApi.createCompany(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.companies() }),
  });
}

export function useUpdateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name?: string; color?: string; description?: string } }) =>
      platformApi.updateCompany(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.companies() }),
  });
}

export function useEnterCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => platformApi.enterCompany(id),
    // Entering another company's sandbox switches server-side session scope:
    // every cached query (bootstrap, issues, …) belongs to the old company.
    onSuccess: () => qc.clear(),
  });
}

/* ---- members ---- */
export function useCompanyMembers(companyId: string | null | undefined) {
  return useQuery({
    queryKey: platformKeys.members(companyId as string),
    queryFn: () => platformApi.members(companyId as string),
    enabled: !!companyId,
  });
}

function useInvalidateMembers() {
  const qc = useQueryClient();
  return (companyId: string) => {
    qc.invalidateQueries({ queryKey: platformKeys.members(companyId) });
    qc.invalidateQueries({ queryKey: platformKeys.companies() }); // memberCount
  };
}

export function useAddMember(companyId: string) {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: (input: AddMemberInput) => platformApi.addMember(companyId, input),
    onSuccess: () => invalidate(companyId),
  });
}

export function useUpdateMemberRole(companyId: string) {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: ({ membershipId, role }: { membershipId: string; role: CompanyRole }) =>
      platformApi.updateMemberRole(companyId, membershipId, role),
    onSuccess: () => invalidate(companyId),
  });
}

export function useRemoveMember(companyId: string) {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: (membershipId: string) => platformApi.removeMember(companyId, membershipId),
    onSuccess: () => invalidate(companyId),
  });
}

/* ---- permissions matrix ---- */
export function usePermissionsMatrix() {
  return useQuery({ queryKey: platformKeys.matrix(), queryFn: () => platformApi.permissionsMatrix() });
}

export function useSavePermissionsMatrix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (matrix: Record<string, Record<string, PermLevel>>) => platformApi.savePermissionsMatrix(matrix),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.matrix() }),
  });
}

/* ---- mcp keys ---- */
export function useMcpKeys() {
  return useQuery({ queryKey: platformKeys.mcpKeys(), queryFn: () => platformApi.mcpKeys() });
}

export function useCreateMcpKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; companyId: string | null }) => platformApi.createMcpKey(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.mcpKeys() }),
  });
}

export function useRevokeMcpKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => platformApi.revokeMcpKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.mcpKeys() }),
  });
}
