import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformApi } from '@/lib/platformApi';
import { api } from '@/lib/api';
import type { AddMemberInput, CompanyRole, CreateCompanyInput, CreateMcpKeyInput, PermLevel } from '@/lib/platformApi';

/* Platform admin React Query hooks. All platform data lives under the
   ['platform', ...] key tree; mutations invalidate their subtree only —
   business data (bootstrap/issues/…) is untouched except by enterCompany,
   which wipes the whole cache before the caller navigates into the sandbox. */

export const platformKeys = {
  all: ['platform'] as const,
  companies: () => [...platformKeys.all, 'companies'] as const,
  members: (companyId: string) => [...platformKeys.all, 'members', companyId] as const,
  users: () => [...platformKeys.all, 'users'] as const,
  matrix: () => [...platformKeys.all, 'permissions-matrix'] as const,
  mcpKeys: () => [...platformKeys.all, 'mcp-keys'] as const,
};

/* ---- companies ---- */
export function useCompanies(enabled = true) {
  return useQuery({ queryKey: platformKeys.companies(), queryFn: () => platformApi.companies(), enabled });
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
export function usePlatformUsers(enabled = true) {
  return useQuery({ queryKey: platformKeys.users(), queryFn: () => platformApi.users(), enabled });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { username: string; name?: string; password: string }) => platformApi.createUser(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.users() }),
  });
}

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
    qc.invalidateQueries({ queryKey: platformKeys.users() }); // 成员目录的席位
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
export function usePermissionsMatrix(enabled = true) {
  return useQuery({ queryKey: platformKeys.matrix(), queryFn: () => platformApi.permissionsMatrix(), enabled });
}

export function useSavePermissionsMatrix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (matrix: Record<string, Record<string, PermLevel>>) => platformApi.savePermissionsMatrix(matrix),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.matrix() }),
  });
}

/* ---- 本公司权限矩阵(pms 域,company_admin 可写) ---- */
export function useCompanyMatrix(enabled = true) {
  return useQuery({ queryKey: ['company-matrix'], queryFn: () => api.companyMatrix(), enabled });
}

export function useSaveCompanyMatrix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (matrix: Record<string, Record<string, PermLevel>>) => api.saveCompanyMatrix(matrix),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-matrix'] });
      qc.invalidateQueries({ queryKey: ['session'] }); // permissions 可能变化
    },
  });
}

/* ---- mcp keys ---- */
export function useMcpKeys() {
  return useQuery({ queryKey: platformKeys.mcpKeys(), queryFn: () => platformApi.mcpKeys() });
}

export function useCreateMcpKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMcpKeyInput) => platformApi.createMcpKey(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.mcpKeys() }),
  });
}

export function useUpdateMcpKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; ownerId?: string; projectIds?: string[] | null }) =>
      platformApi.updateMcpKey(id, input),
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

export function useDeleteMcpKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => platformApi.deleteMcpKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.mcpKeys() }),
  });
}
