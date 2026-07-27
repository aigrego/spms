import type {
  Bootstrap,
  Issue,
  IssueDetail,
  IssueAttachment,
  IssueStatus,
  IssuePriority,
  Importance,
  IssueType,
  Sprint,
  SprintDetail,
  Burndown,
  Velocity,
  ProductLine,
  Product,
  Release,

  ProductStatus,
  ReleaseStatus,
  Requirement,
  RequirementType,
  RequirementCategory,
  RequirementStatus,
  Project,
  ProjectStatus,
  ProjectPhase,
  Member,
  AssignmentNodeType,
  AssignmentRole,
  AssignmentRow,
  AssignCandidates,
  IssueCandidates,
  CascadeImpact,
  TestCase,
  TestCaseStatus,
  TestResult,
} from './types';
import type { PermissionsMatrix } from './platformApi';

// Standalone Next.js rewrite: every business call hits the app's own API routes
// at /api/v1/pms/** (cookie session auth — the browser attaches the cookie).
// The server responds with the { ok:true, data } / { ok:false, error:{code,message} }
// envelope; `call` unwraps it: resolves with `data` on success and rejects with
// ApiError(code, message) on a business error.

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

/* Metadata of an already-uploaded blob, registered as an issue attachment. */
export interface AttachmentMeta {
  url: string;
  pathname: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface CreateIssueInput {
  title: string;
  description?: string;
  teamId?: string;
  type?: IssueType;
  status?: IssueStatus;
  priority?: IssuePriority;
  importance?: Importance;
  assigneeId?: string | null;
  projectId?: string | null;
  requirementId?: string | null;
  sprintId?: string | null;
  estimate?: number | null;
  storyPoints?: number | null;
  labels?: string[];
}

export interface UpdateIssueInput {
  title?: string;
  description?: string | null;
  type?: IssueType;
  status?: IssueStatus;
  priority?: IssuePriority;
  importance?: Importance;
  assigneeId?: string | null;
  projectId?: string | null;
  requirementId?: string | null;
  sprintId?: string | null;
  estimate?: number | null;
  storyPoints?: number | null;
  labels?: string[];
}

export interface CreateRequirementInput {
  projectId: string;
  releaseId?: string | null;
  title: string;
  type?: RequirementType;
  category?: RequirementCategory | null;
  priority?: IssuePriority;
  importance?: Importance;
  status?: RequirementStatus;
  description?: string | null;
  acceptanceCriteria?: string | null;
  aiOwnerId?: string | null;
}

export type UpdateRequirementInput = Partial<CreateRequirementInput>;

export interface CreateTestCaseInput {
  projectId: string;
  requirementId?: string | null;
  title: string;
  priority?: IssuePriority;
  status?: TestCaseStatus;
  result?: TestResult;
  preconditions?: string | null;
  steps?: string | null;
  expected?: string | null;
  assigneeId?: string | null;
}

export type UpdateTestCaseInput = Partial<CreateTestCaseInput>;

export interface ProductInput {
  productLineId: string;
  name: string;
  description?: string | null;
  icon?: string;
  color?: string;
  status?: ProductStatus;
  leadId?: string | null;
}

export interface ReleaseInput {
  productId: string;
  name: string;
  description?: string | null;
  status?: ReleaseStatus;
  phase?: ProjectPhase;
  targetDate?: string | null;
  progress?: number;
}

export interface InviteResourceInput {
  name?: string;
  email?: string;
  // Standalone rewrite: the pool keys off a local users.id (server resources
  // service: invite requires email or userId). portalUserId/homeTenantId are
  // kept for portal parity but unused by the rewritten server.
  userId?: string;
  portalUserId?: string;
  homeTenantId?: string;
}

/* 公司席位:能进入本公司的系统用户及其公司角色(研发资源 · 内部成员段)。 */
export interface Seat {
  membershipId: string;
  userId: string;
  username: string;
  name: string;
  role: string; // company_admin | product_manager | developer | tester | viewer
  createdAt: string;
}

export interface ProjectInput {
  name: string;
  teamId?: string | null;
  releaseId?: string | null;
  status?: ProjectStatus;
  leadId?: string | null;
  aiLeadId?: string | null;
  icon?: string;
  color?: string;
  target?: string | null;
  description?: string | null;
  summary?: string | null;
  goal?: string | null;
  nonGoals?: string | null;
}

/* Notion 集成状态(accessToken 永不下发)。 */
export interface NotionConnectionInfo {
  workspaceId: string | null;
  workspaceName: string | null;
  databaseId: string | null;
  databaseName: string | null;
  projectId: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface NotionDatabaseOption {
  id: string;
  name: string;
}

export interface NotionIntegrationStatus {
  configured: boolean;
  connection: NotionConnectionInfo | null;
  databases?: NotionDatabaseOption[] | null;
  databasesError?: string | null;
}

export interface NotionIntegrationPatch {
  databaseId?: string | null;
  databaseName?: string | null;
  projectId?: string | null;
}

export interface NotionSyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

const PREFIX = '/api/v1/pms';

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

export const api = {
  bootstrap: () => request<Bootstrap>('/bootstrap'),

  issues: (params?: { team?: string; assignee?: string; project?: string; includeArchived?: boolean }) => {
    const q = new URLSearchParams(
      Object.entries({ ...params, includeArchived: params?.includeArchived ? '1' : undefined })
        .filter(([, v]) => v) as [string, string][],
    ).toString();
    return request<Issue[]>(`/issues${q ? `?${q}` : ''}`);
  },

  // Missing issue resolves to null (data: null), not a thrown 404.
  issue: (id: string) => request<IssueDetail | null>(`/issues/${id}`),

  createIssue: (input: CreateIssueInput) => request<IssueDetail>('/issues', json('POST', input)),

  updateIssue: (id: string, input: UpdateIssueInput) =>
    request<IssueDetail>(`/issues/${id}`, json('PATCH', input)),

  archiveIssue: (id: string, archived: boolean) =>
    request<{ id: string; archived: boolean }>(`/issues/${id}/archive`, json('POST', { archived })),

  deleteIssue: (id: string) => request<{ id: string }>(`/issues/${id}`, { method: 'DELETE' }),

  addComment: (id: string, body: string) =>
    request<{ id: string }>(`/issues/${id}/comments`, json('POST', { body })),

  registerAttachment: (issueKey: string, meta: AttachmentMeta) =>
    request<IssueAttachment>(`/issues/${issueKey}/attachments`, json('POST', meta)),

  deleteAttachment: (id: string) => request<{ id: string }>(`/attachments/${id}`, { method: 'DELETE' }),

  toggleSub: (id: string, subId: string, status: IssueStatus) =>
    request<{ id: string; status: IssueStatus }>(`/issues/${id}/sub/${subId}`, json('PATCH', { status })),

  /* ---- Scrum ---- */
  sprints: (team?: string) => request<Sprint[]>(`/sprints${team ? `?team=${team}` : ''}`),

  backlog: (team?: string) => request<Issue[]>(`/sprints/backlog${team ? `?team=${team}` : ''}`),

  sprint: (id: string) => request<SprintDetail | null>(`/sprints/${id}`),

  burndown: (id: string) => request<Burndown | null>(`/sprints/${id}/burndown`),

  velocity: (team?: string) => request<Velocity>(`/sprints/velocity${team ? `?team=${team}` : ''}`),

  moveIssueToSprint: (sprintId: string, issueId: string, storyPoints?: number | null) =>
    request<{ issueId: string; sprintId: string | null }>(
      `/sprints/${sprintId}/issues/${issueId}`,
      json('PATCH', { storyPoints }),
    ),

  createSprint: (input: {
    teamId?: string | null;
    projectId?: string | null;
    name: string;
    goal?: string | null;
    startDate: string;
    endDate: string;
    capacity?: number | null;
  }) => request<Sprint>('/sprints', json('POST', input)),

  updateSprint: (
    id: string,
    input: Partial<{
      teamId: string | null;
      projectId: string | null;
      name: string;
      goal: string | null;
      status: 'planned' | 'active' | 'completed';
      startDate: string;
      endDate: string;
      capacity: number | null;
    }>,
  ) => request<Sprint>(`/sprints/${id}`, json('PATCH', input)),

  deleteSprint: (id: string) => request<{ id: string }>(`/sprints/${id}`, { method: 'DELETE' }),

  startSprint: (id: string) => request<Sprint>(`/sprints/${id}/start`, { method: 'POST' }),

  completeSprint: (id: string) =>
    request<{ sprint: Sprint; movedCount: number }>(`/sprints/${id}/complete`, { method: 'POST' }),

  /* ---- Lifecycle catalog: 产品线 → 产品 → 版本/Release ---- */
  productLines: () => request<ProductLine[]>('/product-lines'),
  createProductLine: (input: { name: string; description?: string | null; color?: string }) =>
    request<{ id: string; key: string }>('/product-lines', json('POST', input)),
  updateProductLine: (id: string, input: { name?: string; description?: string | null; color?: string }) =>
    request<{ id: string }>(`/product-lines/${id}`, json('PATCH', input)),
  deleteProductLine: (id: string) => request<{ id: string }>(`/product-lines/${id}`, { method: 'DELETE' }),

  products: (line?: string) => request<Product[]>(`/products${line ? `?line=${line}` : ''}`),
  createProduct: (input: ProductInput) => request<{ id: string; key: string }>('/products', json('POST', input)),
  updateProduct: (id: string, input: Partial<ProductInput>) =>
    request<{ id: string }>(`/products/${id}`, json('PATCH', input)),
  deleteProduct: (id: string) => request<{ id: string }>(`/products/${id}`, { method: 'DELETE' }),

  releases: (product?: string) => request<Release[]>(`/releases${product ? `?product=${product}` : ''}`),
  createRelease: (input: ReleaseInput) => request<{ id: string; key: string }>('/releases', json('POST', input)),
  updateRelease: (id: string, input: Partial<ReleaseInput>) =>
    request<{ id: string }>(`/releases/${id}`, json('PATCH', input)),
  deleteRelease: (id: string) => request<{ id: string }>(`/releases/${id}`, { method: 'DELETE' }),

  /* ---- Projects ---- */
  createProject: (input: ProjectInput) => request<Project>('/projects', json('POST', input)),
  updateProject: (id: string, input: Partial<ProjectInput>) =>
    request<Project>(`/projects/${id}`, json('PATCH', input)),
  deleteProject: (id: string) => request<{ id: string }>(`/projects/${id}`, { method: 'DELETE' }),
  archiveProject: (id: string, archived: boolean) =>
    request<{ id: string; archived: boolean }>(`/projects/${id}/archive`, json('POST', { archived })),

  /* ---- Requirements / PRD ---- */
  requirements: (params?: { project?: string; type?: RequirementType }) => {
    const q = new URLSearchParams(
      Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][],
    ).toString();
    return request<Requirement[]>(`/requirements${q ? `?${q}` : ''}`);
  },
  requirement: (id: string) => request<Requirement | null>(`/requirements/${id}`),
  createRequirement: (input: CreateRequirementInput) =>
    request<Requirement>('/requirements', json('POST', input)),
  updateRequirement: (id: string, input: UpdateRequirementInput) =>
    request<Requirement>(`/requirements/${id}`, json('PATCH', input)),
  deleteRequirement: (id: string) => request<{ id: string }>(`/requirements/${id}`, { method: 'DELETE' }),

  /* ---- 测试用例 ---- */
  testCases: (params?: { project?: string; requirement?: string; status?: TestCaseStatus; result?: TestResult }) => {
    const q = new URLSearchParams(
      Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][],
    ).toString();
    return request<TestCase[]>(`/test-cases${q ? `?${q}` : ''}`);
  },
  testCase: (id: string) => request<TestCase | null>(`/test-cases/${id}`),
  createTestCase: (input: CreateTestCaseInput) => request<TestCase>('/test-cases', json('POST', input)),
  updateTestCase: (id: string, input: UpdateTestCaseInput) =>
    request<TestCase>(`/test-cases/${id}`, json('PATCH', input)),
  deleteTestCase: (id: string) => request<{ id: string }>(`/test-cases/${id}`, { method: 'DELETE' }),

  /* ---- 研发资源池 (PMS-2 §5.1) ---- */
  resources: () => request<Member[]>('/resources'),
  syncDirectory: () => request<{ synced: number; members: Member[] }>('/resources/sync-directory', { method: 'POST' }),
  inviteResource: (input: InviteResourceInput) => request<Member>('/resources/invite', json('POST', input)),
  revokeResource: (id: string) =>
    request<{ id: string; status: string }>(`/resources/${id}/revoke`, { method: 'POST' }),

  /* ---- 公司席位(研发资源 · 内部成员段) ---- */
  seats: () => request<Seat[]>('/seats'),
  updateSeatRole: (id: string, role: string) => request<{ id: string; role: string }>(`/seats/${id}`, json('PATCH', { role })),
  removeSeat: (id: string) => request<{ id: string }>(`/seats/${id}`, { method: 'DELETE' }),

  /* ---- 本公司权限矩阵(全局默认 + 本公司覆盖) ---- */
  companyMatrix: () => request<PermissionsMatrix>('/permissions-matrix'),
  saveCompanyMatrix: (matrix: PermissionsMatrix['matrix']) =>
    request<unknown>('/permissions-matrix', json('PUT', { matrix })),

  /* ---- 节点资源指派 / 虚拟团队 (PMS-2 §5.2) ---- */
  assignments: (nodeType: AssignmentNodeType, nodeId: string) =>
    request<AssignmentRow[]>(`/assignments?nodeType=${nodeType}&nodeId=${nodeId}`),
  assignCandidates: (nodeType: AssignmentNodeType, nodeId: string) =>
    request<AssignCandidates>(`/assignments/candidates?nodeType=${nodeType}&nodeId=${nodeId}`),
  issueCandidates: (issueKey: string) =>
    request<IssueCandidates>(`/assignments/issue-candidates?issueKey=${encodeURIComponent(issueKey)}`),
  cascadeImpact: (nodeType: AssignmentNodeType, nodeId: string) =>
    request<CascadeImpact>(`/assignments/impact?nodeType=${nodeType}&nodeId=${nodeId}`),
  assign: (input: { nodeType: AssignmentNodeType; nodeId: string; memberId: string; role?: AssignmentRole }) =>
    request<AssignmentRow[]>('/assignments', json('POST', input)),
  setAssignmentRole: (id: string, role: AssignmentRole) =>
    request<{ id: string; role: AssignmentRole }>(`/assignments/${id}`, json('PATCH', { role })),
  unassign: (nodeType: AssignmentNodeType, nodeId: string, memberId: string) =>
    request<{ removed: boolean }>(`/assignments?nodeType=${nodeType}&nodeId=${nodeId}&memberId=${memberId}`, {
      method: 'DELETE',
    }),

  /* ---- Notion 集成 ---- */
  notionIntegration: (opts?: { databases?: boolean }) =>
    request<NotionIntegrationStatus>(`/integrations/notion${opts?.databases ? '?databases=1' : ''}`),
  updateNotionIntegration: (input: NotionIntegrationPatch) =>
    request<NotionIntegrationStatus>('/integrations/notion', json('PATCH', input)),
  disconnectNotion: () => request<{ disconnected: boolean }>('/integrations/notion', { method: 'DELETE' }),
  notionPreview: () => request<{ page: unknown }>('/integrations/notion/preview'),
  syncNotion: () => request<NotionSyncResult>('/integrations/notion/sync', { method: 'POST' }),
};

export type Api = typeof api;

/* ---- Auth (cookie session, not under /api/v1/pms) ---- */
export interface SessionUser {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'member';
  // Multi-company sandbox: platform admins see every company and the
  // /platform console. Absent while the backend rolls out — treated as false.
  isPlatformAdmin?: boolean;
  // Whether a Lark identity is linked (profile page security tab).
  larkBound?: boolean;
  // OAuth 头像（飞书/Lark）；空则展示首字母色块。
  avatarUrl?: string | null;
  // 主邮箱(user_emails),可空。
  email?: string | null;
  // false = 纯 OAuth 账号(可在安全页直接设置密码开通密码登录)。
  hasPassword?: boolean;
}

/* 第三方登录配置（登录页按钮展示）。configured 为 false 时该按钮隐藏。 */
export interface OAuthProviderConfig {
  feishu?: { configured?: boolean; url?: string } | null;
  lark?: { configured?: boolean; url?: string } | null;
}

/* 用户邮箱条目(user_emails)。verified = Lark/飞书 OAuth 回写。 */
export interface UserEmailEntry {
  email: string;
  isPrimary: boolean;
  verified: boolean;
}

/* 登录页实际使用的条目：已配置则展示按钮（附授权 url），否则为 null。 */
export type OAuthEntry = { configured: true; url?: string } | null;

/* Multi-company sandbox contracts (P5). All optional on the wire while the
   backend ships in parallel: the client fails open (full access) when the
   fields are missing. */
export type CompanyRole = 'company_admin' | 'product_manager' | 'developer' | 'tester' | 'viewer';
export type PermLevel = 'none' | 'read' | 'write';
// The 10 RBAC modules; values are 'none' | 'read' | 'write'.
export type ModuleKey =
  | 'issues'
  | 'products'
  | 'requirements'
  | 'testcases'
  | 'projects'
  | 'resources'
  | 'roadmap'
  | 'backlog'
  | 'sprints'
  | 'agents';

export interface SessionCompany {
  id: string;
  key: string;
  name: string;
  color: string;
}

export interface SessionInfo {
  user: SessionUser;
  companies: SessionCompany[];
  currentCompany: SessionCompany | null;
  companyRole: CompanyRole | null;
  // Normalized: the wire may carry it inside `user` or at the envelope top level.
  isPlatformAdmin: boolean;
  // Undefined when the backend predates the multi-company session (fail open).
  permissions?: Partial<Record<ModuleKey, PermLevel>>;
}

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  const env = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!env) throw new ApiError('ERROR', `HTTP ${res.status}`);
  if (env.ok) return env.data;
  throw new ApiError(env.error?.code ?? 'ERROR', env.error?.message ?? 'Unknown error');
}

export const authApi = {
  login: (username: string, password: string) =>
    authRequest<unknown>('/api/auth/login', json('POST', { username, password })),
  logout: () => authRequest<unknown>('/api/auth/logout', { method: 'POST' }),
  // Envelope data is { user, companies?, currentCompany?, companyRole?, permissions? } | null.
  // Older backends return only { user } — the multi-company fields then stay
  // empty/undefined and the UI falls back to single-company, full access.
  getSession: async (): Promise<SessionInfo | null> => {
    const data = await authRequest<{
      user?: SessionUser | null;
      companies?: SessionCompany[];
      currentCompany?: SessionCompany | null;
      companyRole?: CompanyRole | null;
      isPlatformAdmin?: boolean;
      permissions?: Partial<Record<ModuleKey, PermLevel>>;
    } | null>('/api/auth/session');
    if (!data?.user) return null;
    return {
      user: data.user,
      companies: data.companies ?? [],
      currentCompany: data.currentCompany ?? null,
      companyRole: data.companyRole ?? null,
      isPlatformAdmin: data.isPlatformAdmin ?? data.user.isPlatformAdmin ?? false,
      permissions: data.permissions,
    };
  },
  // Switch the active company; callers must clear the query cache afterwards
  // (every query result is company-scoped).
  switchCompany: (companyId: string) =>
    authRequest<unknown>('/api/auth/switch-company', json('POST', { companyId })),
  changePassword: (oldPassword: string | undefined, newPassword: string) =>
    authRequest<unknown>('/api/auth/change-password', json('POST', { oldPassword, newPassword })),
  // 当前用户的邮箱管理(user_emails)。
  listEmails: () => authRequest<UserEmailEntry[]>('/api/auth/emails'),
  addEmail: (email: string) => authRequest<UserEmailEntry[]>('/api/auth/emails', json('POST', { email })),
  setPrimaryEmail: (email: string) =>
    authRequest<UserEmailEntry[]>('/api/auth/emails', json('PATCH', { email })),
  removeEmail: (email: string) =>
    authRequest<UserEmailEntry[]>('/api/auth/emails', json('DELETE', { email })),
  // Update the signed-in user's display name (profile page).
  updateProfile: (name: string) =>
    authRequest<{ user: SessionUser }>('/api/auth/profile', json('PATCH', { name })),
  // 第三方登录（飞书 / Lark）配置探测；未配置/失败时返回 null，按钮隐藏。
  oauthConfig: async (): Promise<{ feishu: OAuthEntry; lark: OAuthEntry } | null> => {
    try {
      const data = await authRequest<OAuthProviderConfig | null>('/api/auth/oauth/config');
      if (!data) return null;
      const entry = (e?: { configured?: boolean; url?: string } | null): OAuthEntry =>
        e?.configured ? { configured: true, url: e.url } : null;
      const feishu = entry(data.feishu);
      const lark = entry(data.lark);
      return feishu || lark ? { feishu, lark } : null;
    } catch {
      return null;
    }
  },
  // 解绑当前账号的飞书/Lark 身份（个人资料-安全页）。
  unbindOauth: () => authRequest<unknown>('/api/auth/oauth/unbind', json('POST', {})),
};
