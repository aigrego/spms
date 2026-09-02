import { ApiError } from './api';

/* Platform admin API (/api/v1/platform/**) — multi-company sandbox + RBAC.
   Kept in its own module (not api.ts) because the pms client is owned by
   another workstream; same { ok, data|error } envelope unwrap pattern. */

export type CompanyRole = 'company_admin' | 'product_manager' | 'developer' | 'tester' | 'viewer';
export type PermLevel = 'none' | 'read' | 'write';

export interface PlatformCompany {
  id: string;
  key: string;
  name: string;
  color: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
}

export interface PlatformMember {
  membershipId: string; // = membership id（API 返回字段名为 id，platformApi 内映射）
  user: { id: string; username: string; name: string };
  role: CompanyRole;
  createdAt: string;
}

/* 平台成员目录:系统用户 + 其公司席位。 */
export interface PlatformUser {
  userId: string;
  username: string;
  name: string;
  email: string | null; // 主邮箱(user_emails),可空
  platformRole: 'admin' | 'member';
  avatarUrl?: string | null;
  createdAt: string;
  seats: {
    membershipId: string;
    role: CompanyRole;
    companyId: string;
    companyName: string;
    companyColor: string | null;
  }[];
}

/* 服务端 members 返回扁平行，在此统一映射为 PlatformMember */
interface RawMember {
  id: string;
  userId: string;
  username: string;
  name: string;
  role: CompanyRole;
  createdAt: string;
}
const mapMember = (r: RawMember): PlatformMember => ({
  membershipId: r.id,
  user: { id: r.userId, username: r.username, name: r.name },
  role: r.role,
  createdAt: r.createdAt,
});

export interface PermissionsMatrix {
  roles: CompanyRole[];
  modules: string[];
  matrix: Record<string, Record<string, PermLevel>>;
}

export type McpCapability = 'read' | 'write' | 'delete';

export interface McpKey {
  id: string;
  name: string;
  prefix: string;
  companyId: string | null; // null = 平台级
  companyName: string | null;
  createdBy: string | null;
  createdByName: string | null;
  ownerId: string | null; // 所属人：MCP 调用的第一人称身份
  ownerName: string | null;
  capabilities: string; // 逗号分隔：read,write,delete
  projectIds: string[] | null; // 项目白名单；null = 全部项目
  expiresAt: string | null; // null = 永不过期
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface CreateMcpKeyInput {
  name: string;
  companyId?: string | null; // member 省略 = 服务端归属当前公司;null = 平台级(仅管理员)
  ownerId?: string; // 所属人，省略 = 创建人本人
  capabilities: McpCapability[];
  expiresInDays: number | null; // null = 永不过期
  projectIds?: string[] | null; // 项目白名单；null/省略 = 全部项目
}

export interface CreateCompanyInput {
  key: string;
  name: string;
  color?: string;
  description?: string;
}

export interface AddMemberInput {
  username: string;
  role: CompanyRole;
  name?: string;
  password?: string;
  email?: string;
}

/* 角色 / 模块中文映射（权限矩阵 + 成员页共用）。 */
export const ROLE_LABELS: Record<CompanyRole, string> = {
  company_admin: '公司管理员',
  product_manager: '产品',
  developer: '开发',
  tester: '测试',
  viewer: '访客',
};

export const MODULE_LABELS: Record<string, string> = {
  issues: 'Issues',
  products: '产品',
  requirements: '需求池',
  testcases: '测试用例',
  projects: '项目',
  resources: '研发资源',
  roadmap: '路线图',
  backlog: '产品待办',
  sprints: '迭代',
  agents: 'AI Agents',
  notion: 'Notion 集成',
};

export const PERM_LEVEL_LABELS: Record<PermLevel, string> = {
  none: '不可见',
  read: '只读',
  write: '读写',
};

const PREFIX = '/api/v1/platform';

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let env: Envelope<T> | null = null;
  try {
    const res = await fetch(PREFIX + path, {
      credentials: 'same-origin',
      ...init,
    });
    env = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (!env) throw new ApiError('ERROR', `HTTP ${res.status}`);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('NETWORK', e instanceof Error ? e.message : String(e));
  }
  if (env.ok) return env.data;
  throw new ApiError(env.error?.code ?? 'ERROR', env.error?.message ?? 'Unknown error');
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const platformApi = {
  /* ---- companies ---- */
  companies: () => request<PlatformCompany[]>('/companies'),
  createCompany: (input: CreateCompanyInput) => request<PlatformCompany>('/companies', json('POST', input)),
  updateCompany: (id: string, input: { name?: string; color?: string; description?: string }) =>
    request<PlatformCompany>(`/companies/${id}`, json('PATCH', input)),
  enterCompany: (id: string) => request<unknown>(`/companies/${id}/enter`, { method: 'POST' }),

  /* ---- members ---- */
  // 平台成员目录：全部系统用户 + 公司席位；新建系统账号
  users: () => request<PlatformUser[]>('/users'),
  createUser: (input: { username: string; name?: string; password: string; email?: string }) =>
    request<{ id: string; username: string; name: string }>('/users', json('POST', input)),
  deleteUser: (userId: string) =>
    request<{ id: string; revokedProjections: number }>(`/users/${userId}`, { method: 'DELETE' }),
  // 服务端返回扁平行 { id, userId, username, name, role, createdAt }，在此映射为 PlatformMember
  members: async (companyId: string) =>
    (await request<RawMember[]>(`/companies/${companyId}/members`)).map(mapMember),
  addMember: async (companyId: string, input: AddMemberInput) =>
    mapMember(await request<RawMember>(`/companies/${companyId}/members`, json('POST', input))),
  updateMemberRole: async (companyId: string, membershipId: string, role: CompanyRole) =>
    mapMember(
      await request<RawMember>(`/companies/${companyId}/members/${membershipId}`, json('PATCH', { role })),
    ),
  removeMember: (companyId: string, membershipId: string) =>
    request<{ id: string }>(`/companies/${companyId}/members/${membershipId}`, { method: 'DELETE' }),

  /* ---- permissions matrix ---- */
  permissionsMatrix: () => request<PermissionsMatrix>('/permissions-matrix'),
  savePermissionsMatrix: (matrix: PermissionsMatrix['matrix']) =>
    request<unknown>('/permissions-matrix', json('PUT', { matrix })),

  /* ---- mcp keys ---- */
  mcpKeys: () => request<McpKey[]>('/mcp-keys'),
  createMcpKey: (input: CreateMcpKeyInput) =>
    request<{ id: string; key: string; prefix: string }>('/mcp-keys', json('POST', input)),
  updateMcpKey: (id: string, input: { ownerId?: string; projectIds?: string[] | null }) =>
    request<{ id: string }>(`/mcp-keys/${id}`, json('PATCH', input)),
  revokeMcpKey: (id: string) => request<{ id: string }>(`/mcp-keys/${id}`, { method: 'DELETE' }),
  // 硬删除（不留审计行），区别于上面的吊销。
  deleteMcpKey: (id: string) => request<{ id: string }>(`/mcp-keys/${id}?permanent=1`, { method: 'DELETE' }),
};

export type PlatformApi = typeof platformApi;
