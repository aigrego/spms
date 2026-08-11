export type IssueStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'testing'
  | 'done'
  | 'canceled';

export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

// 重要度 (impact on the project) — orthogonal to priority (紧急度).
export type Importance = 'critical' | 'high' | 'medium' | 'low' | 'none';

// Issue 类型 — a Bug IS an Issue; the type discriminates the work item.
export type IssueType = 'backlog' | 'ticket' | 'bug';

export type ProjectStatus = 'backlog' | 'planned' | 'in_progress' | 'completed';

// Lifecycle catalog: 产品线 → 产品 → 版本/Release.
export type ProductStatus = 'active' | 'maintenance' | 'archived';
export type ReleaseStatus = 'planned' | 'in_progress' | 'released' | 'deprecated';

// Requirements / PRD.
export type RequirementType = 'functional' | 'non_functional';
export type RequirementCategory =
  | 'performance'
  | 'security'
  | 'usability'
  | 'reliability'
  | 'compatibility'
  | 'maintainability';
export type RequirementStatus =
  | 'draft'
  | 'reviewing'
  | 'approved'
  | 'in_dev'
  | 'shipped'
  | 'rejected';

// Product lifecycle phases — PMS-2: live on the Release (version), not the project.
export type ProjectPhase = 'concept' | 'development' | 'release' | 'maintenance' | 'retired';

export type SprintStatus = 'planned' | 'active' | 'completed';

export type MemberType = 'human' | 'agent';

// PMS-2 §2.1: resource-pool provenance + lifecycle (humans only).
export type MemberOrigin = 'internal' | 'external';
export type MemberStatus = 'active' | 'invited' | 'revoked';

export interface Member {
  id: string;
  type: MemberType;
  name: string;
  initials: string;
  color: string | null;
  role: string | null;
  // TKT-31: 在本公司的角色岗位（company_memberships.role，如 'developer' /
  // 'tester'）；无席位（外部邀请未认领）或 agent 为 null。负责人选择器展示用。
  companyRole?: string | null;
  // PLAN-5: humans project a portal user; agents carry a stable key.
  portalUserId?: string | null;
  agentKey?: string | null;
  // PMS-2 资源池: internal portal users vs invited external resources.
  origin?: MemberOrigin;
  email?: string | null;
  // 外部邀请手机号（认领匹配键，归一化纯数字）。
  phone?: string | null;
  homeTenantId?: string | null;
  status?: MemberStatus;
  // OAuth（飞书/Lark）头像；空则展示首字母色块。
  avatarUrl?: string | null;
}

/* PMS-2 §2.2 — 研发资源 (virtual team) assignments. */
export type AssignmentNodeType = 'product' | 'release' | 'project' | 'sprint';
export type AssignmentRole = 'lead' | 'member';
export type AssignmentSource = 'direct' | 'propagated';

export interface AssignmentRow {
  id: string;
  nodeType: AssignmentNodeType;
  nodeId: string;
  role: AssignmentRole;
  source: AssignmentSource;
  memberId: string;
  member: Member | null;
}

export type CandidateMember = Member & { assignedHere: boolean; inParentPool: boolean };

export interface AssignCandidates {
  node: { nodeType: AssignmentNodeType; nodeId: string };
  hasParent: boolean;
  candidates: CandidateMember[];
}

export interface IssueCandidates {
  source: AssignmentNodeType | 'tenant';
  candidates: Member[];
}

export interface CascadeImpact {
  descendants: { release: number; project: number; sprint: number };
  assignments: number;
}

export interface Team {
  id: string;
  // PLAN-5: the issue-number prefix ("AGT"), tenant-unique.
  key?: string;
  name: string;
  color: string;
}

export interface Label {
  id: string;
  // PLAN-5: stable handle ("ai" finds the AI-生成 label).
  key?: string;
  name: string;
  color: string;
}

export interface ProductLine {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string;
  position: number;
}

export interface Product {
  id: string;
  productLineId: string;
  key: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  status: ProductStatus;
  leadId: string | null;
  position: number;
}

export interface Release {
  id: string;
  productId: string;
  key: string;
  name: string;
  description: string | null;
  status: ReleaseStatus;
  // PMS-2: the product lifecycle phase lives on the version.
  phase: ProjectPhase;
  targetDate: string | null;
  progress: number;
  position: number;
}

export interface Project {
  id: string;
  name: string;
  teamId: string | null;
  releaseId: string | null;
  status: ProjectStatus;
  leadId: string | null;
  aiLeadId: string | null;
  icon: string;
  color: string;
  target: string | null;
  progress: number;
  description: string | null;
  // 基本信息 / PRD basics (surfaced on the project hub's 基本信息 tab).
  summary: string | null; // Executive Summary (概述)
  goal: string | null; // Goals (目标)
  nonGoals: string | null; // Non-Goals (非目标)
  archivedAt?: string | null; // 归档时间;非空时项目卡片默认隐藏、其 issue 从全部 Issues 隐藏
}

export interface Requirement {
  id: string; // display key (functional → "FR-3", non-functional → "NFR-2")
  projectId: string;
  releaseId: string | null; // the version this requirement targets
  title: string;
  type: RequirementType;
  category: RequirementCategory | null;
  priority: IssuePriority;
  importance: Importance;
  status: RequirementStatus;
  description: string | null;
  acceptanceCriteria: string | null;
  authorId: string | null;
  aiOwnerId: string | null;
  position: number;
  issues: string[]; // linked issue keys
  issueStats: { total: number; done: number };
  createdAt: string;
  updatedAt: string;
}

// Test cases (测试用例).
export type TestCaseStatus = 'draft' | 'active' | 'deprecated';
export type TestResult = 'untested' | 'passed' | 'failed' | 'blocked';

export interface TestCase {
  id: string; // display key ("TC-12")
  projectId: string;
  requirementId: string | null; // the requirement display key it validates
  title: string;
  priority: IssuePriority;
  status: TestCaseStatus;
  result: TestResult;
  preconditions: string | null;
  steps: string | null;
  expected: string | null;
  authorId: string | null;
  assigneeId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Sprint {
  id: string;
  teamId: string | null;
  projectIds: string[];
  name: string;
  goal: string | null;
  status: SprintStatus;
  startDate: string;
  endDate: string;
  capacity: number | null;
  createdAt: string;
}

export interface SprintStats {
  committedPoints: number;
  completedPoints: number;
  remainingPoints: number;
  issueCount: number;
  doneCount: number;
}

export interface SprintDetail extends Sprint {
  issues: Issue[];
  stats: SprintStats;
}

export interface BurndownPoint {
  day: number;
  date: string;
  ideal: number;
  actual: number | null;
}

export interface Burndown {
  sprintId: string;
  committed: number;
  totalDays: number;
  points: BurndownPoint[];
}

export interface VelocityEntry {
  sprintId: string;
  name: string;
  status: SprintStatus;
  committed: number;
  completed: number;
  capacity: number | null;
}

export interface Velocity {
  series: VelocityEntry[];
  avgVelocity: number | null;
}

export interface SubIssue {
  id: string;
  title: string;
  status: IssueStatus;
  position: number;
}

export interface Activity {
  id: string;
  whoId: string | null;
  kind: 'created' | 'status' | 'assign' | 'comment' | 'ai';
  body: string;
  createdAt: string;
}

export interface Issue {
  id: string;
  teamId: string | null;
  title: string;
  description: string | null;
  type: IssueType;
  status: IssueStatus;
  priority: IssuePriority;
  importance: Importance;
  assigneeId: string | null;
  projectId: string | null;
  requirementId: string | null;
  sprintId: string | null;
  estimate: number | null;
  storyPoints: number | null;
  backlogRank: number;
  aiAssigned: boolean;
  commentsCount: number;
  labels: string[];
  sub: { done: number; total: number } | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IssueAttachment {
  id: string;
  url: string;
  pathname: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedById: string | null;
  createdAt: string;
}

export interface IssueDetail extends Issue {
  subIssues: SubIssue[];
  activities: Activity[];
  attachments: IssueAttachment[];
}

export interface Notification {
  id: string;
  issueId: string | null;
  whoId: string | null;
  icon: string;
  tone: string;
  text: string;
  read: boolean;
  createdAt: string;
}

export interface Bootstrap {
  // The current user's member id (resolved by the server from the session).
  me: string | null;
  // The current user's user role: 'admin' | 'member'.
  role: string | null;
  members: Member[];
  teams: Team[];
  labels: Label[];
  projects: Project[];
  // 「我参与的」项目 id 集:本人 direct 指派的项目及其指派迭代关联的项目
  // (口径同 visibility.ts);供项目列表的「全部/我参与的」筛选。
  myProjectIds: string[];
  sprints: Sprint[];
  productLines: ProductLine[];
  products: Product[];
  releases: Release[];
}

/* Daily reports (日报) — 每人每天一份,内容按产品拆分(entries)。
   `date` 是客户端本地时区的日历日 'YYYY-MM-DD'。 */
export interface DailyReportEntry {
  id: string;
  productId: string;
  content: string;
  position: number;
}

export interface DailyReport {
  id: string;
  memberId: string;
  date: string;
  entries: DailyReportEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface SaveMyReportInput {
  date: string;
  entries: { productId: string; content: string }[];
}

export interface ReportStats {
  totalReports: number;
  todayCount: number;
  memberCount: number;
  trend: { date: string; count: number }[];
  unsubmitted: { id: string; name: string }[];
}
