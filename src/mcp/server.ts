import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { put } from '@vercel/blob';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { companies, companyMemberships, labels, members, productLines, products, projects, releases, sprints, teams, users } from '@/db/schema';
import { ApiException, type ErrorCode } from '@/lib/envelope';
import { ensureAgents, ensureCurrentMember } from '@/lib/identity';
import { computeRollups } from '@/lib/rollup';
import { clampAllowed, visibleSetsFor } from '@/lib/visibility';
import * as issueSvc from '@/server/services/issues';
import * as attachmentSvc from '@/server/services/attachments';
import * as projectSvc from '@/server/services/projects';
import * as requirementSvc from '@/server/services/requirements';
import * as resourceSvc from '@/server/services/resources';
import * as sprintSvc from '@/server/services/sprints';
import * as testCaseSvc from '@/server/services/testcases';
import type { Actor } from '@/server/services/types';

/* MCP server (Phase D) — a thin adapter over src/server/services/*. Tools share
   the exact business rules of the REST API; this file only does zod validation,
   actor resolution, and result/error wrapping. See docs/MCP.md for the tool
   contract. Stateless: a fresh McpServer is created per HTTP request.

   Multi-company sandbox: the route handler authenticates the request into a
   McpKeyContext and every tool call resolves its Actor from it —
     - company-level key  → that company's sandbox, always;
     - platform-level key → the tool's optional `companyId` argument, defaulting
       to the first company (createdAt asc);
     - browser session    → the session user's resolved actor (companyId
       argument ignored).
   DB key actors act as the key's 所属人 (owner; defaults to the creator) with
   that user's real company role — first-person identity and RBAC both come from
   the owner. Env fallback keys (no owner) keep the legacy behavior of acting
   as the company's built-in `scribe` agent (docs/MCP.md §操作者身份). */

export interface McpKeyContext {
  companyId: string | null; // null = platform-level key
  /* 令牌所属人 (users.id)。DB key 必有（老数据已回填为创建人）；env 兜底 key
     与浏览器 session 为 null。 */
  ownerId: string | null;
  source: 'db' | 'env' | 'session';
  sessionActor?: Actor; // source === 'session': the already-resolved actor
  // DB key 的能力上限（read/write/delete）；env 兜底 key 与浏览器会话为全量。
  capabilities: string[];
  /* DB key 的项目白名单（null = 全部项目）；env 兜底 key 与浏览器会话不设限制。 */
  projectIds?: string[] | null;
}

/* The first company (createdAt asc) — default target of a platform-level key
   when a tool call omits `companyId`. */
async function defaultCompanyId(): Promise<string | null> {
  const [c] = await db.select({ id: companies.id }).from(companies).orderBy(asc(companies.createdAt)).limit(1);
  return c?.id ?? null;
}

/* MCP 操作者身份：DB key → 令牌所属人本人，companyRole 取其在目标公司的真实
   membership 角色（与 requireActor() 同规则：平台管理员无 membership 时按
   company_admin）。所属人非目标公司成员 → FORBIDDEN。
   ownerId 为空（env 兜底 key）→ 公司内置 `scribe` agent member + company_admin
   的遗留行为。 */
async function buildMcpActor(companyId: string, ownerId: string | null): Promise<Actor> {
  if (ownerId) {
    const [u] = await db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(eq(users.id, ownerId))
      .limit(1);
    if (!u) throw new ApiException('UNAUTHORIZED', '令牌所属人不存在，请在 /agent-access 修改令牌所属人', 401);
    const isPlatformAdmin = u.role === 'admin';
    const [ms] = await db
      .select({ role: companyMemberships.role })
      .from(companyMemberships)
      .where(and(eq(companyMemberships.userId, u.id), eq(companyMemberships.companyId, companyId)))
      .limit(1);
    if (!ms && !isPlatformAdmin) {
      throw new ApiException('FORBIDDEN', '令牌所属人不是该公司成员，请在 /agent-access 修改令牌所属人', 403);
    }
    const member = await ensureCurrentMember(u, companyId);
    return {
      userId: u.id,
      memberId: member?.id ?? null,
      name: u.name,
      role: u.role,
      companyId,
      companyRole: ms?.role ?? 'company_admin',
      isPlatformAdmin,
    };
  }
  await ensureAgents(companyId); // fallback for an empty company
  const [scribe] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.companyId, companyId), eq(members.agentKey, 'scribe')))
    .limit(1);
  if (!scribe) throw new Error('scribe agent member missing after ensureAgents()');
  return {
    userId: 'mcp',
    memberId: scribe.id,
    name: 'MCP Agent',
    role: 'member',
    companyId,
    companyRole: 'company_admin',
    isPlatformAdmin: false,
  };
}

/* ---- bootstrap payload ----------------------------------------------------
   Mirrors services/meta.bootstrap minus permissions/companies: the MCP actor
   is a synthetic agent (no users row), so the membership-driven parts do not
   apply. currentCompany is kept so the Agent can confirm which sandbox it is
   operating in. */
async function loadBootstrap(actor: Actor) {
  const companyId = actor.companyId;
  await ensureAgents(companyId);
  const [memberRows, teamRows, labelRows, projectRows, sprintRows, productLineRows, productRows, releaseRows] =
    await Promise.all([
      db.select().from(members).where(eq(members.companyId, companyId)),
      db.select().from(teams).where(eq(teams.companyId, companyId)),
      db.select().from(labels).where(eq(labels.companyId, companyId)),
      db.select().from(projects).where(eq(projects.companyId, companyId)),
      db.select().from(sprints).where(eq(sprints.companyId, companyId)).orderBy(asc(sprints.startDate)),
      db
        .select()
        .from(productLines)
        .where(eq(productLines.companyId, companyId))
        .orderBy(asc(productLines.position)),
      db.select().from(products).where(eq(products.companyId, companyId)).orderBy(asc(products.position)),
      db.select().from(releases).where(eq(releases.companyId, companyId)).orderBy(asc(releases.position)),
    ]);
  // Project/release progress is derived from issue completion, not the stored column.
  const { projectProgress, releaseProgress } = await computeRollups(companyId);
  const [currentCompany] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  // 令牌项目白名单 ∩ 指派可见性(visibility.ts):projects/sprints/products/
  // releases 同步收窄,避免泄露范围外节点;productLines 为导航壳不过滤。
  const visible = await visibleSetsFor(actor);
  const visibleProjectIds = clampAllowed(actor, visible?.projectIds ?? null);
  const visibleSprintIds = visible ? new Set(visible.sprintIds) : null;
  const visibleProductIds = visible ? new Set(visible.productIds) : null;
  const visibleReleaseIds = visible ? new Set(visible.releaseIds) : null;
  // sprint 归属项目还须在(白名单 ∩ 可见性)项目集内。
  const sprintProjectAllowed = visibleProjectIds ? new Set(visibleProjectIds) : null;
  return {
    me: actor.memberId,
    role: actor.role,
    companyRole: actor.companyRole,
    currentCompany: currentCompany ?? null,
    members: memberRows,
    teams: teamRows,
    labels: labelRows,
    projects: (visibleProjectIds ? projectRows.filter((p) => visibleProjectIds.includes(p.id)) : projectRows).map(
      (p) => ({ ...p, progress: projectProgress.get(p.id) ?? 0 }),
    ),
    sprints:
      visibleSprintIds || sprintProjectAllowed
        ? sprintRows.filter(
            (s) =>
              (!visibleSprintIds || visibleSprintIds.has(s.id)) &&
              (!sprintProjectAllowed || (s.projectId != null && sprintProjectAllowed.has(s.projectId))),
          )
        : sprintRows,
    productLines: productLineRows,
    products: visibleProductIds ? productRows.filter((p) => visibleProductIds.has(p.id)) : productRows,
    releases: (visibleReleaseIds ? releaseRows.filter((r) => visibleReleaseIds.has(r.id)) : releaseRows).map((r) => ({
      ...r,
      progress: releaseProgress.get(r.id) ?? 0,
    })),
  };
}

/* ---- result / error wrapping --------------------------------------------- */
type ToolText = { type: 'text'; text: string };
type ToolImage = { type: 'image'; data: string; mimeType: string };
type ToolContent = ToolText | ToolImage;

function okResult(data: unknown): { content: ToolText[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errResult(code: ErrorCode | 'INTERNAL', message: string): { isError: true; content: ToolText[] } {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code, message }, null, 2) }] };
}

/* Run a service call, turning ApiException into an MCP tool error. Read
   services return null for missing rows — surfaced as a NOT_FOUND tool error
   so the agent gets an explicit signal instead of a bare `null`. */
async function run(fn: () => Promise<unknown>): Promise<{ content: ToolText[] } | { isError: true; content: ToolText[] }> {
  try {
    return okResult(await fn());
  } catch (e) {
    if (e instanceof ApiException) return errResult(e.code, e.message);
    throw e;
  }
}

function found<T>(data: T | null, code: ErrorCode, message: string): T {
  if (data == null) throw new ApiException(code, message);
  return data;
}

/* Infer an image MIME type from a filename extension (for attachment upload). */
function imageMimeFromFilename(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
  };
  return map[ext] ?? null;
}

/* ---- zod enums (aligned with src/db/schema.ts pgEnum values) -------------- */
const issueStatus = z.enum(['backlog', 'todo', 'in_progress', 'testing', 'in_review', 'done', 'canceled']);
const issuePriority = z.enum(['urgent', 'high', 'medium', 'low', 'none']);
const issueImportance = z.enum(['critical', 'high', 'medium', 'low', 'none']);
const issueType = z.enum(['backlog', 'ticket', 'bug']);
const requirementType = z.enum(['functional', 'non_functional']);
const requirementCategory = z.enum(['performance', 'security', 'usability', 'reliability', 'compatibility', 'maintainability']);
const requirementStatus = z.enum(['draft', 'reviewing', 'approved', 'in_dev', 'shipped', 'rejected']);
const testCaseStatus = z.enum(['draft', 'active', 'deprecated']);
const testResult = z.enum(['untested', 'passed', 'failed', 'blocked']);

/* Company selector attached to every tool: only meaningful for platform-level
   keys; company-level keys and browser sessions ignore it. */
const companyIdParam = z
  .string()
  .optional()
  .describe('目标公司 id。平台级 key 时必选目标公司 id（未传默认第一个公司）；公司级 key 忽略此参数');

const CONCEPTS = [
  '概念：Issue 是统一工作项，type=bug 即缺陷、ticket 即工单/任务、backlog 即备忘。',
  '所有实体用展示 key 引用（BUG-3 / TKT-7 / FR-2 / NFR-1 / TC-1），内部 uuid 不暴露。',
  'issue 状态枚举：backlog|todo|in_progress|testing|in_review|done|canceled；需求状态：draft|reviewing|approved|in_dev|shipped|rejected。',
  'priority（紧急度）：urgent|high|medium|low|none；importance（重要度）：critical|high|medium|low|none，两者正交。',
  '成员（member）分 human 与 agent（atlas/forge/sentry/scribe 四个内置 AI），assigneeId 用 member id，issue 可指派给 agent。',
].join(' ');

/* ---- server factory (one instance per stateless HTTP request) ------------- */
export function createMcpServer(keyContext: McpKeyContext): McpServer {
  const server = new McpServer({ name: 'next-spms', version: '0.1.0' });

  /* 能力门（DB key 的 capabilities 是上限）：带 readOnlyHint 的工具要 read，
     其余写工具要 write；delete 预留（当前无删除类工具）。超限不执行，直接
     返回 FORBIDDEN 工具错误。env 兜底 key / 浏览器会话为全量能力。
     实现上包装 server.registerTool 并保持其泛型签名，调用点类型推断不变。 */
  type LooseConfig = { annotations?: { readOnlyHint?: boolean } };
  type LooseHandler = (callArgs: unknown, extra: unknown) => unknown;
  const reg = ((name: string, config: LooseConfig, handler: LooseHandler) => {
    const cap = config.annotations?.readOnlyHint ? 'read' : 'write';
    const guarded: LooseHandler = async (callArgs, extra) => {
      if (!keyContext.capabilities.includes(cap)) {
        return errResult(
          'FORBIDDEN',
          `此 API Key 没有「${cap === 'read' ? '读取' : '写入'}」能力（签发时未勾选），请换用具备该能力的 Key`,
        );
      }
      return handler(callArgs, extra);
    };
    return server.registerTool(name, config as never, guarded as never);
  }) as unknown as typeof server.registerTool;

  /* Resolve the Actor for one tool call from the authenticated key context. */
  async function actorFor(requestedCompanyId?: string): Promise<Actor> {
    if (keyContext.source === 'session') {
      if (!keyContext.sessionActor) throw new ApiException('UNAUTHORIZED', '会话无效', 401);
      return keyContext.sessionActor; // the session user's current company; companyId arg ignored
    }
    let companyId = keyContext.companyId; // company-level key: pinned sandbox
    if (!companyId) {
      // Platform-level key: explicit target wins, else the first company.
      if (requestedCompanyId) {
        const [c] = await db
          .select({ id: companies.id })
          .from(companies)
          .where(eq(companies.id, requestedCompanyId))
          .limit(1);
        if (!c) throw new ApiException('NOT_FOUND', `公司 ${requestedCompanyId} 不存在`);
        companyId = c.id;
      } else {
        companyId = await defaultCompanyId();
      }
    }
    if (!companyId) throw new ApiException('NOT_FOUND', '不存在任何公司');
    const actor = await buildMcpActor(companyId, keyContext.ownerId);
    // DB key 的项目白名单随 actor 下发，service 层据此过滤。
    if (keyContext.projectIds?.length) actor.allowedProjectIds = keyContext.projectIds;
    return actor;
  }

  /* ================= 读 ================= */

  reg(
    'spms_get_bootstrap',
    {
      description:
        `全量参考数据：members（含 agent 成员及其 id）/labels/projects（含派生进度）/sprints/productLines/products/releases，附 currentCompany 标明当前公司沙箱。` +
        `建议会话开始时调用一次，拿到项目 id、迭代 id、成员 id、label id 供后续工具使用。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
      inputSchema: { companyId: companyIdParam },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        return loadBootstrap(actor);
      }),
  );

  reg(
    'spms_list_companies',
    {
      description:
        `公司列表。平台级 key 返回全部公司（按创建时间升序）；公司级 key 只返回 key 所属的那一个公司。` +
        `返回的 id 可用作其他工具的 companyId 参数（仅平台级 key 需要）。`,
      annotations: { readOnlyHint: true },
    },
    async () =>
      run(async () => {
        // Company-scoped contexts (company key, non-admin session) see only
        // their own company; platform contexts (platform key, admin session)
        // see them all.
        const scopedId =
          keyContext.source === 'session'
            ? keyContext.sessionActor?.isPlatformAdmin
              ? null
              : (keyContext.sessionActor?.companyId ?? null)
            : keyContext.companyId;
        if (scopedId) {
          const [c] = await db.select().from(companies).where(eq(companies.id, scopedId)).limit(1);
          return c ? [c] : [];
        }
        return db.select().from(companies).orderBy(asc(companies.createdAt));
      }),
  );

  reg(
    'spms_list_issues',
    {
      description:
        `Issue 列表，筛选均可选。type='bug' 即缺陷列表。返回的 id 字段是展示 key（如 BUG-3）。` +
        `assignee/project/sprint 传对应 id（id 可从 spms_get_bootstrap 获得）。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
      inputSchema: {
        companyId: companyIdParam,
        status: issueStatus.optional().describe('按状态筛选'),
        type: issueType.optional().describe("按类型筛选；type='bug' 即缺陷列表"),
        priority: issuePriority.optional().describe('按紧急度筛选'),
        assignee: z.string().optional().describe('负责人 member id'),
        project: z.string().optional().describe('项目 id'),
        sprint: z.string().optional().describe('迭代 id'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        // The service natively filters by assignee/project; the rest are
        // post-filtered on the serialized rows (id there is the display key).
        const rows = await issueSvc.listIssues(actor, { assignee: args.assignee, project: args.project });
        return rows.filter(
          (r) =>
            (args.status === undefined || r.status === args.status) &&
            (args.type === undefined || r.type === args.type) &&
            (args.priority === undefined || r.priority === args.priority) &&
            (args.sprint === undefined || r.sprintId === args.sprint),
        );
      }),
  );

  reg(
    'spms_get_issue',
    {
      description:
        `Issue 详情：按展示 key（如 BUG-3）查询，含 labels/subIssues/activities（created/status/comment 等历史流）与 attachments 附件元数据。` +
        `图片附件会同时以 image 内容块返回，可直接看图识别（如 bug 截图、UI 稿）。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
      inputSchema: {
        companyId: companyIdParam,
        key: z.string().describe("Issue 展示 key，如 'BUG-3'"),
      },
    },
    async (args) => {
      try {
        const actor = await actorFor(args.companyId);
        const issue = found(await issueSvc.getIssue(actor, args.key), 'ISSUE_NOT_FOUND', `Issue ${args.key} 不存在`);
        const content: ToolContent[] = [{ type: 'text', text: JSON.stringify(issue, null, 2) }];
        // Inline image attachments as MCP image blocks so the agent can see
        // them, not just their URLs. Per-image failures degrade to a note.
        const images = (issue.attachments ?? []).filter((a) => a.contentType.startsWith('image/')).slice(0, 10);
        const failed: string[] = [];
        for (const a of images) {
          try {
            const res = await fetch(a.url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            content.push({ type: 'text', text: `图片附件：${a.filename}` });
            content.push({ type: 'image', data: buf.toString('base64'), mimeType: a.contentType });
          } catch {
            failed.push(a.filename);
          }
        }
        if (failed.length) content.push({ type: 'text', text: `以下图片附件拉取失败：${failed.join('、')}` });
        return { content };
      } catch (e) {
        if (e instanceof ApiException) return errResult(e.code, e.message);
        throw e;
      }
    },
  );

  reg(
    'spms_list_requirements',
    {
      description: `需求列表（附关联 issue 完成度）。返回的 id 字段是展示 key（FR-N / NFR-N）。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
      inputSchema: {
        companyId: companyIdParam,
        project: z.string().optional().describe('项目 id'),
        type: requirementType.optional().describe('functional=功能需求 / non_functional=非功能需求'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        return requirementSvc.listRequirements(actor, { project: args.project, type: args.type });
      }),
  );

  reg(
    'spms_get_requirement',
    {
      description: `需求详情：PRD 描述/验收标准/关联 issue 列表，按展示 key（如 FR-2）查询。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
      inputSchema: {
        companyId: companyIdParam,
        key: z.string().describe("需求展示 key，如 'FR-2' 或 'NFR-1'"),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        return found(await requirementSvc.getRequirement(actor, args.key), 'REQUIREMENT_NOT_FOUND', `需求 ${args.key} 不存在`);
      }),
  );

  reg(
    'spms_list_projects',
    {
      description: `项目列表（含按 issue 完成度派生的 progress）。项目用 uuid id 引用。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
      inputSchema: { companyId: companyIdParam },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        return (await loadBootstrap(actor)).projects;
      }),
  );

  reg(
    'spms_list_sprints',
    {
      description: `迭代列表（按开始日期升序）。迭代用 uuid id 引用。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
      inputSchema: { companyId: companyIdParam },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        return sprintSvc.listSprints(actor);
      }),
  );

  reg(
    'spms_get_sprint',
    {
      description: `迭代详情：元信息 + committed issue 列表 + committed/completed/remaining 点数统计。id 从 spms_list_sprints 获得。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
      inputSchema: {
        companyId: companyIdParam,
        id: z.string().describe('迭代 id（uuid）'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        return found(await sprintSvc.getSprint(actor, args.id), 'SPRINT_NOT_FOUND', `迭代 ${args.id} 不存在`);
      }),
  );

  reg(
    'spms_start_sprint',
    {
      description: `启动迭代（planned → active）。同一项目同时只能有一个进行中的迭代，冲突时报错。id 从 spms_list_sprints 获得。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        id: z.string().describe('迭代 id（uuid）'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        return sprintSvc.startSprint(actor, args.id);
      }),
  );

  reg(
    'spms_complete_sprint',
    {
      description: `完成迭代（active → completed）。未完成（非 done/canceled）的 Issue 自动移回产品待办，返回 { sprint, movedCount }。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        id: z.string().describe('迭代 id（uuid）'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        return sprintSvc.completeSprint(actor, args.id);
      }),
  );

  reg(
    'spms_list_test_cases',
    {
      description: `测试用例列表。status：draft|active|deprecated；result：untested|passed|failed|blocked。requirement 传展示 key（FR-N）。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
      inputSchema: {
        companyId: companyIdParam,
        project: z.string().optional().describe('项目 id'),
        requirement: z.string().optional().describe("需求展示 key，如 'FR-2'"),
        status: testCaseStatus.optional(),
        result: testResult.optional(),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        const { companyId: _companyId, ...filter } = args;
        return testCaseSvc.listTestCases(actor, filter);
      }),
  );

  reg(
    'spms_list_members',
    {
      description: `成员列表（human/agent，含 id、agentKey、状态）。assigneeId、leadId 等参数从这里取 member id。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
      inputSchema: { companyId: companyIdParam },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        return resourceSvc.listMembers(actor);
      }),
  );

  /* ================= 写 ================= */

  reg(
    'spms_create_issue',
    {
      description:
        `创建 Issue。创建缺陷传 type='bug'（返回 key 形如 BUG-N）；工单/任务 type='ticket'（默认）；备忘 type='backlog'。` +
        `requirementId 传需求展示 key（FR-N）；assigneeId/projectId/sprintId/labels 传对应 id（spms_get_bootstrap 可查）。` +
        `sprint 属于某个项目时，issue 会自动归属该项目（projectId 冲突会报 LIFECYCLE_MISMATCH）。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        title: z.string().describe('标题（必填）'),
        type: issueType.optional().describe("默认 'ticket'；缺陷传 'bug'"),
        status: issueStatus.optional().describe("默认 'todo'"),
        priority: issuePriority.optional().describe("默认 'none'"),
        importance: issueImportance.optional().describe("默认 'none'"),
        description: z.string().optional().describe('描述（Markdown）'),
        assigneeId: z.string().optional().describe('负责人 member id（可指派给 agent 成员）'),
        projectId: z.string().optional().describe('项目 id'),
        requirementId: z.string().optional().describe("需求展示 key，如 'FR-2'"),
        sprintId: z.string().optional().describe('迭代 id'),
        estimate: z.number().optional().describe('预估工时'),
        storyPoints: z.number().optional().describe('故事点'),
        labels: z.array(z.string()).optional().describe('label id 数组（全量替换语义）'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        const { companyId: _companyId, ...input } = args;
        return issueSvc.createIssue(actor, input);
      }),
  );

  reg(
    'spms_update_issue',
    {
      description:
        `更新 Issue（按展示 key，如 BUG-3）：可改 status/priority/importance/title/description/assigneeId/projectId/` +
        `requirementId（展示 key）/sprintId/estimate/storyPoints/labels（全量替换）。只传要改的字段；显式传 null 可清空可空字段。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        key: z.string().describe("Issue 展示 key，如 'BUG-3'"),
        title: z.string().optional(),
        description: z.string().nullable().optional(),
        type: issueType.optional(),
        status: issueStatus.optional(),
        priority: issuePriority.optional(),
        importance: issueImportance.optional(),
        assigneeId: z.string().nullable().optional().describe('负责人 member id；null 取消指派'),
        projectId: z.string().nullable().optional(),
        requirementId: z.string().nullable().optional().describe("需求展示 key；null 解除关联"),
        sprintId: z.string().nullable().optional().describe('迭代 id；null 移回产品待办'),
        estimate: z.number().nullable().optional(),
        storyPoints: z.number().nullable().optional(),
        labels: z.array(z.string()).optional().describe('label id 数组（全量替换）'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        const { companyId: _companyId, key, ...input } = args;
        return issueSvc.updateIssue(actor, key, input);
      }),
  );

  reg(
    'spms_add_comment',
    {
      description: `给 Issue 加评论（写入 activities 流，kind=comment，操作者为 MCP Agent/scribe）。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        key: z.string().describe("Issue 展示 key，如 'BUG-3'"),
        body: z.string().describe('评论内容（不能为空）'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        return issueSvc.addComment(actor, args.key, args.body);
      }),
  );

  reg(
    'spms_upload_issue_attachment',
    {
      description:
        `上传图片附件到 Issue（按展示 key，如 BUG-3）。data 传图片二进制的 base64 编码；支持 jpeg/png/gif/webp/avif，单个 ≤10MB` +
        `（MCP 调用走 HTTP 请求体，部署平台对请求体大小有限制，过大的图片可能在到达服务前被网关拒绝）。` +
        `典型用法：Agent 完成任务后先调用本工具上传结果截图，再调用 spms_update_issue 把 status 置为 'done' 关闭 Issue。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        key: z.string().describe("Issue 展示 key，如 'BUG-3'"),
        filename: z.string().describe("文件名，如 'result.png'"),
        data: z.string().describe('图片二进制内容的 base64 编码'),
        contentType: z
          .enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'])
          .optional()
          .describe('图片 MIME 类型；不传则按 filename 扩展名推断'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        const buf = Buffer.from(args.data, 'base64');
        if (buf.length === 0 || buf.length > attachmentSvc.MAX_ATTACHMENT_SIZE) {
          throw new ApiException('VALIDATION_FAILED', '附件大小需在 10MB 以内');
        }
        const contentType = args.contentType ?? imageMimeFromFilename(args.filename);
        if (!contentType) {
          throw new ApiException('VALIDATION_FAILED', '无法从文件名推断图片类型，请显式传 contentType');
        }
        const safeName = args.filename.split(/[\\/]/).pop() || 'image';
        // Server-side upload (agents can't do the browser client-direct flow).
        const blob = await put(`issues/${actor.companyId}/${crypto.randomUUID()}-${safeName}`, buf, {
          access: 'public',
          contentType,
          addRandomSuffix: true,
        });
        return attachmentSvc.registerAttachment(actor, args.key, {
          url: blob.url,
          pathname: blob.pathname,
          filename: safeName,
          contentType,
          size: buf.length,
        });
      }),
  );

  reg(
    'spms_create_requirement',
    {
      description:
        `创建需求（自动分配 key：functional→FR-N，non_functional→NFR-N）。category 仅对 non_functional 有意义。` +
        `releaseId 传版本 id（spms_get_bootstrap 的 releases）。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        projectId: z.string().describe('项目 id（必填）'),
        title: z.string().describe('需求标题（必填）'),
        type: requirementType.optional().describe("默认 'functional'"),
        category: requirementCategory.optional().describe('NFR 分类（仅 type=non_functional 时有效）'),
        priority: issuePriority.optional(),
        importance: issueImportance.optional(),
        description: z.string().optional().describe('PRD 描述（Markdown）'),
        acceptanceCriteria: z.string().optional().describe('验收标准'),
        releaseId: z.string().optional().describe('版本/Release id'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        const { companyId: _companyId, ...input } = args;
        return requirementSvc.createRequirement(actor, input);
      }),
  );

  reg(
    'spms_update_requirement',
    {
      description:
        `更新需求（按展示 key，如 FR-2）：可改 status/title/type/category/priority/importance/description/` +
        `acceptanceCriteria/releaseId/projectId/position。需求状态：draft|reviewing|approved|in_dev|shipped|rejected。只传要改的字段。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        key: z.string().describe("需求展示 key，如 'FR-2'"),
        title: z.string().optional(),
        type: requirementType.optional().describe('改为 functional 会清空 category'),
        category: requirementCategory.nullable().optional(),
        status: requirementStatus.optional(),
        priority: issuePriority.optional(),
        importance: issueImportance.optional(),
        description: z.string().nullable().optional(),
        acceptanceCriteria: z.string().nullable().optional(),
        releaseId: z.string().nullable().optional(),
        projectId: z.string().optional(),
        position: z.number().optional(),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        const { companyId: _companyId, key, ...input } = args;
        return requirementSvc.updateRequirement(actor, key, input);
      }),
  );

  reg(
    'spms_create_test_case',
    {
      description: `创建测试用例（自动分配 TC-N key，初始 status=draft、result=untested）。requirementId 传需求展示 key（FR-N）。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        projectId: z.string().describe('项目 id（必填）'),
        title: z.string().describe('用例标题（必填）'),
        requirementId: z.string().optional().describe("需求展示 key，如 'FR-2'"),
        priority: issuePriority.optional(),
        preconditions: z.string().optional().describe('前置条件'),
        steps: z.string().optional().describe('测试步骤'),
        expected: z.string().optional().describe('预期结果'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        const { companyId: _companyId, ...input } = args;
        return testCaseSvc.createTestCase(actor, input);
      }),
  );

  reg(
    'spms_update_test_case',
    {
      description:
        `更新测试用例（按展示 key，如 TC-1）：可改 title/priority/status（draft|active|deprecated）/result（untested|passed|failed|blocked）/` +
        `preconditions/steps/expected/requirementId（展示 key）/assigneeId/position。执行结果用 result 字段记录。只传要改的字段。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        key: z.string().describe("用例展示 key，如 'TC-1'"),
        title: z.string().optional(),
        status: testCaseStatus.optional(),
        result: testResult.optional().describe('执行结果：passed/failed/blocked，未执行 untested'),
        priority: issuePriority.optional(),
        preconditions: z.string().nullable().optional(),
        steps: z.string().nullable().optional(),
        expected: z.string().nullable().optional(),
        requirementId: z.string().nullable().optional().describe("需求展示 key；null 解除关联"),
        assigneeId: z.string().nullable().optional(),
        projectId: z.string().optional(),
        position: z.number().optional(),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        const { companyId: _companyId, key, ...input } = args;
        return testCaseSvc.updateTestCase(actor, key, input);
      }),
  );

  reg(
    'spms_move_issue_to_sprint',
    {
      description:
        `把 Issue 移入/移出迭代。sprintId 传迭代 id，或 '_backlog' 移出迭代（回到产品待办）。` +
        `迭代属于项目时 issue 自动归属该项目。可同时更新 storyPoints。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        sprintId: z.string().describe("迭代 id，或 '_backlog' 移出迭代"),
        issueKey: z.string().describe("Issue 展示 key，如 'BUG-3'"),
        storyPoints: z.number().nullable().optional().describe('可选，同时更新故事点'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        return sprintSvc.moveIssue(actor, args.sprintId, args.issueKey, args.storyPoints);
      }),
  );

  reg(
    'spms_create_project',
    {
      description: `创建项目（初始 status=backlog）。releaseId 传版本 id、leadId 传负责人 member id（spms_get_bootstrap / spms_list_members 可查）。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        name: z.string().describe('项目名称（必填）'),
        releaseId: z.string().optional().describe('版本/Release id'),
        leadId: z.string().optional().describe('负责人 member id'),
        target: z.string().optional().describe('目标说明'),
        description: z.string().optional().describe('项目描述'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        const { companyId: _companyId, ...input } = args;
        return projectSvc.createProject(actor, input);
      }),
  );

  return server;
}
