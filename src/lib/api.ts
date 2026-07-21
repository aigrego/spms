import type {
  Bootstrap,
  Issue,
  IssueDetail,
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

  issues: (params?: { team?: string; assignee?: string; project?: string }) => {
    const q = new URLSearchParams(
      Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][],
    ).toString();
    return request<Issue[]>(`/issues${q ? `?${q}` : ''}`);
  },

  // Missing issue resolves to null (data: null), not a thrown 404.
  issue: (id: string) => request<IssueDetail | null>(`/issues/${id}`),

  createIssue: (input: CreateIssueInput) => request<IssueDetail>('/issues', json('POST', input)),

  updateIssue: (id: string, input: UpdateIssueInput) =>
    request<IssueDetail>(`/issues/${id}`, json('PATCH', input)),

  deleteIssue: (id: string) => request<{ id: string }>(`/issues/${id}`, { method: 'DELETE' }),

  addComment: (id: string, body: string) =>
    request<{ id: string }>(`/issues/${id}/comments`, json('POST', { body })),

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
};

export type Api = typeof api;

/* ---- Auth (cookie session, not under /api/v1/pms) ---- */
export interface SessionUser {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'member';
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
  // Envelope data is { user } | null.
  getSession: async (): Promise<SessionUser | null> => {
    const data = await authRequest<{ user?: SessionUser | null } | null>('/api/auth/session');
    return data?.user ?? null;
  },
  // 飞书扫码登录配置探测（Phase B2 提供）；未配置/失败时返回 null，按钮隐藏。
  larkConfig: async (): Promise<{ configured: boolean; url?: string } | null> => {
    try {
      const data = await authRequest<{ configured?: boolean; url?: string } | null>('/api/auth/lark/config');
      return data && data.configured ? { configured: true, url: data.url } : null;
    } catch {
      return null;
    }
  },
};
