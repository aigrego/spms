import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  primaryKey,
  pgEnum,
  uniqueIndex,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';
import type { NotionStatusRule } from '@/lib/notionStatusMap';
import { relations, sql } from 'drizzle-orm';

/* ------------------------------------------------------------------ */
/* Multi-company sandbox note                                          */
/* Every business table carries `companyId` → companies.id (cascade):  */
/* each company is a fully isolated sandbox. Business `key` columns    */
/* are unique per company — unique constraints are (companyId, key).   */
/* Surrogate text PKs are kept everywhere; user-facing identity lives  */
/* in `key`. `users` stays platform-level (role = platform admin);     */
/* per-company roles live in `company_memberships` + `role_permissions`.*/
/* ------------------------------------------------------------------ */

/* Enums */
export const memberTypeEnum = pgEnum('member_type', ['human', 'agent']);
// Resource-pool provenance + lifecycle for human members.
//   internal = a local user; external = an invited guest / email invitee
//   (nameable + assignable immediately; auto-claimed via email match on the
//   invitee's first Feishu/Lark login — see identity.claimExternalInvites).
//   origin is ignored for agents.
export const memberOriginEnum = pgEnum('member_origin', ['internal', 'external']);
export const memberStatusEnum = pgEnum('member_status', ['active', 'invited', 'revoked']);
export const issueStatusEnum = pgEnum('issue_status', [
  'backlog',
  'todo',
  'in_progress',
  'testing',
  'in_review',
  'done',
  'canceled',
]);
export const issuePriorityEnum = pgEnum('issue_priority', [
  'urgent',
  'high',
  'medium',
  'low',
  'none',
]);
// Issue type (类型) — a Bug IS an Issue; `type` discriminates the work item so the
// Issue umbrella can hold 备忘 (backlog), 工单 (ticket) and 缺陷 (bug) alike.
export const issueTypeEnum = pgEnum('issue_type', ['backlog', 'ticket', 'bug']);
// Importance (重要度) — impact on the project, orthogonal to priority (紧急度).
export const issueImportanceEnum = pgEnum('issue_importance', [
  'critical',
  'high',
  'medium',
  'low',
  'none',
]);
export const projectStatusEnum = pgEnum('project_status', [
  'backlog',
  'planned',
  'in_progress',
  'completed',
]);
// Product Life Cycle (PLC) phases — live on the RELEASE (a version moves
// through these), not the project.
export const lifecyclePhaseEnum = pgEnum('lifecycle_phase', [
  'concept', // 构思
  'development', // 开发
  'release', // 发布
  'maintenance', // 维护
  'retired', // 退役
]);
// Lifecycle catalog: 产品线 → 产品 → 版本/Release → 项目/迭代 → Issue.
export const productStatusEnum = pgEnum('product_status', ['active', 'maintenance', 'archived']);
export const releaseStatusEnum = pgEnum('release_status', [
  'planned',
  'in_progress',
  'released',
  'deprecated',
]);
// Requirements / PRD: functional vs non-functional, with an NFR category.
export const requirementTypeEnum = pgEnum('requirement_type', ['functional', 'non_functional']);
export const requirementCategoryEnum = pgEnum('requirement_category', [
  'performance',
  'security',
  'usability',
  'reliability',
  'compatibility',
  'maintainability',
]);
export const requirementStatusEnum = pgEnum('requirement_status', [
  'draft',
  'reviewing',
  'approved',
  'in_dev',
  'shipped',
  'rejected',
]);
export const activityKindEnum = pgEnum('activity_kind', [
  'created',
  'status',
  'assign',
  'comment',
  'ai',
]);
export const sprintStatusEnum = pgEnum('sprint_status', ['planned', 'active', 'completed']);
// Test cases (测试用例): lifecycle status + last-run result.
export const testCaseStatusEnum = pgEnum('test_case_status', ['draft', 'active', 'deprecated']);
export const testResultEnum = pgEnum('test_result', ['untested', 'passed', 'failed', 'blocked']);
// 研发资源 (virtual team) — a member is assigned to a lifecycle node.
//   nodeType is one of product/release/project/sprint (NOT product line).
//   source distinguishes a deliberate `direct` assignment from a `propagated`
//   one auto-created up the ancestor chain.
export const assignmentNodeEnum = pgEnum('assignment_node', ['product', 'release', 'project', 'sprint']);
export const assignmentRoleEnum = pgEnum('assignment_role', ['lead', 'member']);
export const assignmentSourceEnum = pgEnum('assignment_source', ['direct', 'propagated']);

/* ------------------------------------------------------------------ */
/* Local auth users + key counters (new in the Next.js rewrite)        */
/* ------------------------------------------------------------------ */

/* Users — local login accounts (username/password). role: 'admin'|'member'. */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull().default('member'), // 'admin' | 'member'
  larkUnionId: text('lark_union_id').unique(),
  // OAuth 头像（飞书/Lark user_info 的 avatar），登录时刷新；空则展示首字母色块。
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* User emails — 一个用户可拥有多个邮箱（主邮箱 is_primary 唯一 + 备用邮箱）。
   平台级（随 users），邮箱全表唯一即"一个邮箱只属于一个用户"。
   verified = 经 Lark/飞书 OAuth 回写的邮箱（唯一验证来源，无 SMTP）——只有
   verified 邮箱可用于认领外部邀请/授予席位；自填邮箱仅作展示、登录标识与
   Notion 指派人匹配。 */
export const userEmails = pgTable(
  'user_emails',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    email: text('email').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    verified: boolean('verified').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_emails_email_uidx').on(t.email),
    // 每人至多一个主邮箱（部分唯一索引）。
    uniqueIndex('user_emails_primary_uidx').on(t.userId).where(sql`${t.isPrimary}`),
    index('user_emails_user_idx').on(t.userId),
  ],
);

/* ------------------------------------------------------------------ */
/* Companies (安全沙箱) + per-company access control                     */
/* ------------------------------------------------------------------ */

/* Companies — the isolation unit. Every business row belongs to one. */
export const companies = pgTable('companies', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  color: text('color'),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* Company memberships — which users can enter which company, with a
   per-company role: 'company_admin' | 'product_manager' | 'developer' |
   'tester' | 'viewer'. */
export const companyMemberships = pgTable(
  'company_memberships',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    companyId: text('company_id')
      .references(() => companies.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('company_memberships_user_company_uidx').on(t.userId, t.companyId)],
);

/* Role permissions — the configurable per-module access matrix for the
   non-admin company roles. level: 'none' | 'read' | 'write'.
   company_admin is implicit full access and intentionally not seeded here.
   companyId '' = 全局默认;非空 = 该公司对全局的按单元格覆盖。 */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    companyId: text('company_id').notNull().default(''),
    role: text('role').notNull(),
    module: text('module').notNull(),
    level: text('level').notNull(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.role, t.module] })],
);

/* MCP API keys — sha256(key) is stored, never the raw key. `prefix` keeps
   the first 8 chars for display. companyId NULL = platform-level key. */
export const mcpApiKeys = pgTable('mcp_api_keys', {
  id: text('id').primaryKey(),
  keyHash: text('key_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  name: text('name').notNull(),
  companyId: text('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  // 所属人：持 key 调 MCP 时的第一人称身份（默认创建人，可修改）。NULL（用户被删）
  // 时 key 调用报 UNAUTHORIZED，需在 /agent-access 重新指定所属人。
  ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
  // 能力上限：逗号分隔的 read/write/delete。MCP 层强制：读工具要 read、写工具要
  // write（delete 预留，当前无删除类工具）。
  capabilities: text('capabilities').notNull().default('read,write'),
  // 项目白名单：NULL = 全部项目（存量令牌默认不限制）；否则只能访问列出的项目。
  projectIds: text('project_ids').array(),
  // null = 永不过期；到期即 401（无需吊销）。
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  // 最近一次通过 MCP 鉴权的时间（60s 节流写入）。
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* Counters — atomic sequences for business keys (BUG-7, TC-3, ...),
   scoped per company: PK (companyId, name). */
export const counters = pgTable(
  'counters',
  {
    companyId: text('company_id')
      .references(() => companies.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.name] })],
);

/* ------------------------------------------------------------------ */
/* Members (humans + AI agents share one table for assignee FK)        */
/*   human  → userId = the local users.id this member projects          */
/*   agent  → agentKey ('atlas' | 'forge' | 'sentry' | 'scribe')        */
/* ------------------------------------------------------------------ */
export const members = pgTable(
  'members',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .references(() => companies.id, { onDelete: 'cascade' })
      .notNull(),
    type: memberTypeEnum('type').notNull().default('human'),
    name: text('name').notNull(),
    initials: text('initials').notNull(),
    color: text('color'),
    role: text('role'),
    // humans: the local users.id this member projects. FK set null：删用户时
    // member 行保留(姓名快照 + 历史 issue/活动归属不丢),服务层 deleteUser
    // 先 revoke(移出指派、置 revoked)再删 users 行。
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    // agents: stable key used to address the agent (assign / dispatch).
    agentKey: text('agent_key'),
    // resource pool (only meaningful for humans):
    origin: memberOriginEnum('origin').notNull().default('internal'),
    email: text('email'),
    status: memberStatusEnum('status').notNull().default('active'),
    // OAuth 头像（随 users.avatarUrl 同步）；空则展示首字母色块。
    avatarUrl: text('avatar_url'),
  },
  (t) => [
    uniqueIndex('members_user_uidx').on(t.companyId, t.userId),
    uniqueIndex('members_agent_uidx').on(t.companyId, t.agentKey),
    // External invitees may have no userId yet → fall back to email for de-dup.
    // NULL emails are distinct in Postgres, so internal rows are fine.
    uniqueIndex('members_email_uidx').on(t.companyId, t.email),
  ],
);

/* Teams — `key` is the issue-number prefix ("AGT"), unique per company. */
export const teams = pgTable(
  'teams',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .references(() => companies.id, { onDelete: 'cascade' })
      .notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    color: text('color').notNull(),
  },
  (t) => [uniqueIndex('teams_key_uidx').on(t.companyId, t.key)],
);

/* Labels — `key` is a stable handle ("ai" finds the AI-生成 label),
   unique per company. */
export const labels = pgTable(
  'labels',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .references(() => companies.id, { onDelete: 'cascade' })
      .notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    color: text('color').notNull(),
  },
  (t) => [uniqueIndex('labels_key_uidx').on(t.companyId, t.key)],
);

/* Sprints (Scrum) — real dates + committed points.
   A sprint belongs to exactly ONE project (the lifecycle parent); its
   release/product are derived through the project. teamId kept for compat. */
export const sprints = pgTable('sprints', {
  id: text('id').primaryKey(),
  companyId: text('company_id')
    .references(() => companies.id, { onDelete: 'cascade' })
    .notNull(),
  teamId: text('team_id').references(() => teams.id),
  // the project this iteration delivers. Deleting the project cascade-
  // deletes its sprints (cascade-down rule).
  projectId: text('project_id').references((): any => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  goal: text('goal'),
  status: sprintStatusEnum('status').notNull().default('planned'),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }).notNull(),
  capacity: integer('capacity'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* Daily burndown snapshot */
export const sprintSnapshots = pgTable('sprint_snapshots', {
  id: text('id').primaryKey(),
  companyId: text('company_id')
    .references(() => companies.id, { onDelete: 'cascade' })
    .notNull(),
  sprintId: text('sprint_id')
    .references(() => sprints.id, { onDelete: 'cascade' })
    .notNull(),
  day: timestamp('day', { withTimezone: true }).notNull(),
  remainingPoints: integer('remaining_points').notNull(),
});

/* ------------------------------------------------------------------ */
/* Lifecycle catalog — 产品线 → 产品 → 版本/Release                      */
/* ------------------------------------------------------------------ */

/* Product lines (产品线) — top of the lifecycle. `key` unique per company. */
export const productLines = pgTable(
  'product_lines',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .references(() => companies.id, { onDelete: 'cascade' })
      .notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color').notNull().default('#0063D3'),
    position: integer('position').notNull().default(0),
  },
  (t) => [uniqueIndex('product_lines_key_uidx').on(t.companyId, t.key)],
);

/* Products (产品) — belong to a product line. */
export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .references(() => companies.id, { onDelete: 'cascade' })
      .notNull(),
    productLineId: text('product_line_id')
      .references(() => productLines.id, { onDelete: 'cascade' })
      .notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    icon: text('icon').notNull().default('box'),
    color: text('color').notNull().default('#0063D3'),
    status: productStatusEnum('status').notNull().default('active'),
    leadId: text('lead_id').references(() => members.id),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    uniqueIndex('products_key_uidx').on(t.companyId, t.key),
    index('products_line_idx').on(t.productLineId),
  ],
);

/* Releases (版本/Release) — belong to a product; delivered by projects/sprints. */
export const releases = pgTable(
  'releases',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .references(() => companies.id, { onDelete: 'cascade' })
      .notNull(),
    productId: text('product_id')
      .references(() => products.id, { onDelete: 'cascade' })
      .notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    status: releaseStatusEnum('status').notNull().default('planned'),
    // the product lifecycle phase lives on the version.
    phase: lifecyclePhaseEnum('phase').notNull().default('concept'),
    targetDate: timestamp('target_date', { withTimezone: true }),
    progress: real('progress').notNull().default(0),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    uniqueIndex('releases_key_uidx').on(t.companyId, t.key),
    index('releases_product_idx').on(t.productId),
  ],
);

/* Projects */
export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  companyId: text('company_id')
    .references(() => companies.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  teamId: text('team_id').references(() => teams.id),
  // the release this project delivers (nullable). Deleting the release
  // cascade-deletes its projects (cascade-down rule).
  releaseId: text('release_id').references((): any => releases.id, { onDelete: 'cascade' }),
  status: projectStatusEnum('status').notNull().default('backlog'),
  leadId: text('lead_id').references(() => members.id),
  aiLeadId: text('ai_lead_id').references(() => members.id),
  icon: text('icon').notNull().default('box'),
  color: text('color').notNull().default('#0063D3'),
  target: text('target'),
  progress: real('progress').notNull().default(0),
  description: text('description'),
  // 基本信息 / PRD basics surfaced on the project hub's 基本信息 tab.
  summary: text('summary'), // Executive Summary (概述)
  goal: text('goal'), // Goals (目标)
  nonGoals: text('non_goals'), // Non-Goals (非目标)
  // 归档:非 NULL 时项目卡片默认隐藏,其全部 issue 从「全部 Issues」/产品待办
  // 隐藏(等效批量归档);历史上下文(项目中心/迭代详情)仍可见。
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

/* Requirements / PRD (需求) — scoped to a project; decomposed into issues. */
export const requirements = pgTable(
  'requirements',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .references(() => companies.id, { onDelete: 'cascade' })
      .notNull(),
    key: text('key').notNull(),
    projectId: text('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    // the version this requirement targets (nullable). Derived consistency:
    // should match project.releaseId; surfaced as a warning if not.
    releaseId: text('release_id').references((): any => releases.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    type: requirementTypeEnum('type').notNull().default('functional'),
    // Only meaningful for non_functional requirements; null for functional ones.
    category: requirementCategoryEnum('category'),
    priority: issuePriorityEnum('priority').notNull().default('none'),
    importance: issueImportanceEnum('importance').notNull().default('none'),
    status: requirementStatusEnum('status').notNull().default('draft'),
    description: text('description'), // the PRD body / spec
    acceptanceCriteria: text('acceptance_criteria'),
    authorId: text('author_id').references(() => members.id),
    // The AI agent (Atlas) that maintains this PRD, if any.
    aiOwnerId: text('ai_owner_id').references(() => members.id),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('requirements_key_uidx').on(t.companyId, t.key),
    index('requirements_project_idx').on(t.projectId),
  ],
);

/* Issues — text surrogate PK + display `key` ("BUG-7") unique per company */
export const issues = pgTable(
  'issues',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .references(() => companies.id, { onDelete: 'cascade' })
      .notNull(),
    key: text('key').notNull(),
    // Team concept retired from the UI: an Issue is now project-driven. teamId is
    // kept (nullable) only for legacy sprint/team filtering, derived from the project.
    teamId: text('team_id').references(() => teams.id),
    title: text('title').notNull(),
    description: text('description'),
    type: issueTypeEnum('type').notNull().default('ticket'),
    status: issueStatusEnum('status').notNull().default('todo'),
    priority: issuePriorityEnum('priority').notNull().default('none'),
    importance: issueImportanceEnum('importance').notNull().default('none'),
    assigneeId: text('assignee_id').references(() => members.id),
    // deleting a project detaches its issues (set null), not delete them —
    // cascade stops at 迭代; issues survive.
    projectId: text('project_id').references((): any => projects.id, { onDelete: 'set null' }),
    // The PRD/requirement this issue implements (nullable).
    requirementId: text('requirement_id').references((): any => requirements.id, {
      onDelete: 'set null',
    }),
    sprintId: text('sprint_id').references((): any => sprints.id, { onDelete: 'set null' }),
    estimate: integer('estimate'),
    storyPoints: integer('story_points'),
    backlogRank: integer('backlog_rank').notNull().default(0),
    aiAssigned: boolean('ai_assigned').notNull().default(false),
    commentsCount: integer('comments_count').notNull().default(0),
    // 归档:非 NULL 时从「全部 Issues」/产品待办默认隐藏(可用 includeArchived
    // 找回);迭代详情/项目中心等历史上下文仍显示。
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // 完成时间:状态进入 done 时写入,离开 done 清空;「最近一周完成」过滤的
    // 依据。Notion 同步的 done issue 回写为页面 created_time(真实完成时刻
    // 不可考,创建时间是最佳近似)。
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('issues_key_uidx').on(t.companyId, t.key),
    index('issues_team_idx').on(t.teamId),
    index('issues_sprint_idx').on(t.sprintId),
  ],
);

/* Issue <-> Label (many-to-many) */
export const issueLabels = pgTable(
  'issue_labels',
  {
    companyId: text('company_id')
      .references(() => companies.id, { onDelete: 'cascade' })
      .notNull(),
    issueId: text('issue_id')
      .references(() => issues.id, { onDelete: 'cascade' })
      .notNull(),
    labelId: text('label_id')
      .references(() => labels.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.labelId] })],
);

/* Sub-issues (checklist on an issue) */
export const subIssues = pgTable('sub_issues', {
  id: text('id').primaryKey(),
  companyId: text('company_id')
    .references(() => companies.id, { onDelete: 'cascade' })
    .notNull(),
  issueId: text('issue_id')
    .references(() => issues.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  status: issueStatusEnum('status').notNull().default('todo'),
  position: integer('position').notNull().default(0),
});

/* Image attachments on an issue (Vercel Blob, client-direct upload).
   `pathname` is the blob pathname — needed to delete the blob later. */
export const issueAttachments = pgTable(
  'issue_attachments',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .references(() => companies.id, { onDelete: 'cascade' })
      .notNull(),
    issueId: text('issue_id')
      .references(() => issues.id, { onDelete: 'cascade' })
      .notNull(),
    url: text('url').notNull(),
    pathname: text('pathname').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    uploadedById: text('uploaded_by_id').references(() => members.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('issue_attachments_issue_idx').on(t.issueId)],
);

/* Activity / comments feed on an issue */
export const activities = pgTable('activities', {
  id: text('id').primaryKey(),
  companyId: text('company_id')
    .references(() => companies.id, { onDelete: 'cascade' })
    .notNull(),
  issueId: text('issue_id')
    .references(() => issues.id, { onDelete: 'cascade' })
    .notNull(),
  whoId: text('who_id').references(() => members.id),
  kind: activityKindEnum('kind').notNull().default('comment'),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Test cases (测试用例) — project-scoped, optionally validating a       */
/* requirement. Addressed by display `key` ("TC-N"), mirroring the issue */
/* / requirement key contract.                                           */
/* ------------------------------------------------------------------ */
export const testCases = pgTable(
  'test_cases',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .references(() => companies.id, { onDelete: 'cascade' })
      .notNull(),
    key: text('key').notNull(),
    // scope: deleting the project cascade-deletes its test cases.
    projectId: text('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    // the requirement this case validates (nullable); detaches if that req is deleted.
    requirementId: text('requirement_id').references((): any => requirements.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    priority: issuePriorityEnum('priority').notNull().default('none'),
    status: testCaseStatusEnum('status').notNull().default('draft'),
    result: testResultEnum('result').notNull().default('untested'),
    preconditions: text('preconditions'),
    steps: text('steps'),
    expected: text('expected'),
    // set null on member delete so removing a member never blocks on these refs.
    authorId: text('author_id').references(() => members.id, { onDelete: 'set null' }),
    assigneeId: text('assignee_id').references(() => members.id, { onDelete: 'set null' }),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('test_cases_key_uidx').on(t.companyId, t.key),
    index('test_cases_project_idx').on(t.projectId),
  ],
);

/* ------------------------------------------------------------------ */
/* Resource assignments (虚拟团队)                                       */
/* A member assigned to a lifecycle node. Polymorphic (no FK to the node */
/* tables); the application layer guarantees referential integrity and   */
/* cleans up a node's assignments when the node is deleted. memberId      */
/* cascades so revoking/deleting a member clears their whole virtual-team  */
/* footprint in one go.                                                   */
/* ------------------------------------------------------------------ */
export const resourceAssignments = pgTable(
  'resource_assignments',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .references(() => companies.id, { onDelete: 'cascade' })
      .notNull(),
    nodeType: assignmentNodeEnum('node_type').notNull(),
    nodeId: text('node_id').notNull(),
    memberId: text('member_id')
      .references(() => members.id, { onDelete: 'cascade' })
      .notNull(),
    role: assignmentRoleEnum('role').notNull().default('member'),
    source: assignmentSourceEnum('source').notNull().default('direct'),
    // the member who performed the assignment (operator), nullable. set null on
    // delete so removing a member never blocks on this back-reference (memberId
    // cascades; addedById just detaches).
    addedById: text('added_by_id').references(() => members.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ra_node_member_uidx').on(t.nodeType, t.nodeId, t.memberId),
    index('ra_node_idx').on(t.nodeType, t.nodeId),
    index('ra_member_idx').on(t.memberId),
  ],
);

/* ------------------------------------------------------------------ */
/* Notion integration (阶段 1: 连接 + 预览)                              */
/* One connection per company. accessToken stays server-side only —     */
/* it must never be serialized out through any API response.            */
/* ------------------------------------------------------------------ */
export const notionConnections = pgTable(
  'notion_connections',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .references(() => companies.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id'),
    workspaceName: text('workspace_name'),
    botId: text('bot_id'),
    // 敏感:永不通过 API 序列化输出。
    accessToken: text('access_token').notNull(),
    databaseId: text('database_id'),
    databaseName: text('database_name'),
    // 状态映射/过滤规则:每个 Notion 状态 → { SPMS status, 是否同步 };
    // NULL = 内置默认映射(见 lib/notionStatusMap)。
    statusMap: jsonb('status_map').$type<NotionStatusRule[]>(),
    // 同步目标项目;项目被删时仅解除引用,不删连接。
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('notion_connections_company_uidx').on(t.companyId)],
);

/* Notion page ↔ issue mapping (同步映射/幂等):一页面对应一个 issue。 */
export const notionIssueLinks = pgTable(
  'notion_issue_links',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .references(() => companies.id, { onDelete: 'cascade' })
      .notNull(),
    connectionId: text('connection_id')
      .references(() => notionConnections.id, { onDelete: 'cascade' })
      .notNull(),
    notionPageId: text('notion_page_id').notNull(),
    issueId: text('issue_id')
      .references(() => issues.id, { onDelete: 'cascade' })
      .notNull(),
    notionLastEditedAt: timestamp('notion_last_edited_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('notion_issue_links_conn_page_uidx').on(t.connectionId, t.notionPageId),
    uniqueIndex('notion_issue_links_issue_uidx').on(t.issueId),
  ],
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */
export const issuesRelations = relations(issues, ({ one, many }) => ({
  team: one(teams, { fields: [issues.teamId], references: [teams.id] }),
  assignee: one(members, { fields: [issues.assigneeId], references: [members.id] }),
  project: one(projects, { fields: [issues.projectId], references: [projects.id] }),
  requirement: one(requirements, { fields: [issues.requirementId], references: [requirements.id] }),
  sprint: one(sprints, { fields: [issues.sprintId], references: [sprints.id] }),
  issueLabels: many(issueLabels),
  subIssues: many(subIssues),
  activities: many(activities),
  attachments: many(issueAttachments),
}));

export const productLinesRelations = relations(productLines, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  productLine: one(productLines, {
    fields: [products.productLineId],
    references: [productLines.id],
  }),
  lead: one(members, { fields: [products.leadId], references: [members.id] }),
  releases: many(releases),
}));

export const releasesRelations = relations(releases, ({ one, many }) => ({
  product: one(products, { fields: [releases.productId], references: [products.id] }),
  projects: many(projects),
  requirements: many(requirements),
}));

export const requirementsRelations = relations(requirements, ({ one, many }) => ({
  project: one(projects, { fields: [requirements.projectId], references: [projects.id] }),
  release: one(releases, { fields: [requirements.releaseId], references: [releases.id] }),
  author: one(members, { fields: [requirements.authorId], references: [members.id] }),
  aiOwner: one(members, { fields: [requirements.aiOwnerId], references: [members.id] }),
  issues: many(issues),
}));

export const issueLabelsRelations = relations(issueLabels, ({ one }) => ({
  issue: one(issues, { fields: [issueLabels.issueId], references: [issues.id] }),
  label: one(labels, { fields: [issueLabels.labelId], references: [labels.id] }),
}));

export const subIssuesRelations = relations(subIssues, ({ one }) => ({
  issue: one(issues, { fields: [subIssues.issueId], references: [issues.id] }),
}));

export const issueAttachmentsRelations = relations(issueAttachments, ({ one }) => ({
  issue: one(issues, { fields: [issueAttachments.issueId], references: [issues.id] }),
  uploadedBy: one(members, { fields: [issueAttachments.uploadedById], references: [members.id] }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  issue: one(issues, { fields: [activities.issueId], references: [issues.id] }),
  who: one(members, { fields: [activities.whoId], references: [members.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  team: one(teams, { fields: [projects.teamId], references: [teams.id] }),
  release: one(releases, { fields: [projects.releaseId], references: [releases.id] }),
  lead: one(members, { fields: [projects.leadId], references: [members.id] }),
  aiLead: one(members, { fields: [projects.aiLeadId], references: [members.id] }),
  issues: many(issues),
  requirements: many(requirements),
  sprints: many(sprints),
}));

export const sprintsRelations = relations(sprints, ({ one, many }) => ({
  team: one(teams, { fields: [sprints.teamId], references: [teams.id] }),
  project: one(projects, { fields: [sprints.projectId], references: [projects.id] }),
  issues: many(issues),
  snapshots: many(sprintSnapshots),
}));

export const sprintSnapshotsRelations = relations(sprintSnapshots, ({ one }) => ({
  sprint: one(sprints, { fields: [sprintSnapshots.sprintId], references: [sprints.id] }),
}));

export const resourceAssignmentsRelations = relations(resourceAssignments, ({ one }) => ({
  member: one(members, { fields: [resourceAssignments.memberId], references: [members.id] }),
}));

export const testCasesRelations = relations(testCases, ({ one }) => ({
  project: one(projects, { fields: [testCases.projectId], references: [projects.id] }),
  requirement: one(requirements, { fields: [testCases.requirementId], references: [requirements.id] }),
}));
