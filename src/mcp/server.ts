import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { put } from '@vercel/blob';
import { z } from 'zod';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { db } from '@/db';
import { companies, companyMemberships, labels, members, productLines, products, projects, releases, sprints, sprintProjects, teams, users } from '@/db/schema';
import { ApiException, type ErrorCode } from '@/lib/envelope';
import { ensureAgents, ensureCurrentMember } from '@/lib/identity';
import { computeRollups } from '@/lib/rollup';
import { formatReportContent } from '@/lib/reportMarkdown';
import { clampAllowed, visibleSetsFor } from '@/lib/visibility';
import * as issueSvc from '@/server/services/issues';
import * as attachmentSvc from '@/server/services/attachments';
import * as catalogSvc from '@/server/services/catalog';
import * as planSvc from '@/server/services/plans';
import * as projectSvc from '@/server/services/projects';
import * as requirementSvc from '@/server/services/requirements';
import * as reportSvc from '@/server/services/reports';
import * as resourceSvc from '@/server/services/resources';
import * as sprintSvc from '@/server/services/sprints';
import * as testCaseSvc from '@/server/services/testcases';
import type { Actor } from '@/server/services/types';
import { reviewWithWorkflow, updateIssueWithWorkflow } from './workflow';

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
  const [memberRows, teamRows, labelRows, projectRows, sprintRows, sprintProjectRows, productLineRows, productRows, releaseRows] =
    await Promise.all([
      db.select().from(members).where(eq(members.companyId, companyId)),
      db.select().from(teams).where(eq(teams.companyId, companyId)),
      db.select().from(labels).where(eq(labels.companyId, companyId)),
      db.select().from(projects).where(eq(projects.companyId, companyId)),
      db.select().from(sprints).where(eq(sprints.companyId, companyId)).orderBy(asc(sprints.startDate)),
      db.select().from(sprintProjects).where(eq(sprintProjects.companyId, companyId)),
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
  // sprint 须与(白名单 ∩ 可见性)项目集有交集(多项目迭代经 sprint_projects)。
  const sprintProjectAllowed = visibleProjectIds ? new Set(visibleProjectIds) : null;
  const projectsBySprint = new Map<string, string[]>();
  for (const l of sprintProjectRows) {
    projectsBySprint.set(l.sprintId, [...(projectsBySprint.get(l.sprintId) ?? []), l.projectId]);
  }
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
    sprints: sprintRows
      .filter(
        (s) =>
          (!visibleSprintIds || visibleSprintIds.has(s.id)) &&
          (!sprintProjectAllowed || (projectsBySprint.get(s.id) ?? []).some((pid) => sprintProjectAllowed.has(pid))),
      )
      .map((s) => ({ ...s, projectIds: projectsBySprint.get(s.id) ?? [] })),
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
const issueStatus = z.enum(['backlog', 'todo', 'in_progress', 'testing', 'done', 'canceled']);
const issuePriority = z.enum(['urgent', 'high', 'medium', 'low', 'none']);
const issueImportance = z.enum(['critical', 'high', 'medium', 'low', 'none']);
const issueType = z.enum(['backlog', 'ticket', 'bug']);
const requirementType = z.enum(['functional', 'non_functional']);
const requirementCategory = z.enum(['performance', 'security', 'usability', 'reliability', 'compatibility', 'maintainability']);
const requirementStatus = z.enum(['draft', 'reviewing', 'approved', 'in_dev', 'shipped', 'rejected']);
const testCaseStatus = z.enum(['draft', 'active', 'deprecated']);
const testResult = z.enum(['untested', 'passed', 'failed', 'blocked']);
const releaseStatus = z.enum(['planned', 'in_progress', 'released', 'deprecated']);
const lifecyclePhase = z.enum(['concept', 'development', 'release', 'maintenance', 'retired']);
const productStatus = z.enum(['active', 'maintenance', 'archived']);
const projectStatus = z.enum(['backlog', 'planned', 'in_progress', 'completed']);
const planStatus = z.enum(['draft', 'generated']);

/* Company selector attached to every tool: only meaningful for platform-level
   keys; company-level keys and browser sessions ignore it. */
const companyIdParam = z
  .string()
  .optional()
  .describe('目标公司 id。平台级 key 时必选目标公司 id（未传默认第一个公司）；公司级 key 忽略此参数');

const CONCEPTS = [
  '概念：Issue 是统一工作项，type=bug 即缺陷、ticket 即工单/任务、backlog 即备忘。',
  '所有实体用展示 key 引用（BUG-3 / TKT-7 / FR-2 / NFR-1 / TC-1 / PLAN-1），内部 uuid 不暴露。',
  'issue 状态枚举：backlog|todo|in_progress|testing|done|canceled；需求状态：draft|reviewing|approved|in_dev|shipped|rejected。',
  'priority（紧急度）：urgent|high|medium|low|none；importance（重要度）：critical|high|medium|low|none，两者正交。',
  '成员（member）分 human 与 agent（atlas/forge/sentry/scribe 四个内置 AI），assigneeId 用 member id，issue 可指派给 agent。',
].join(' ');

/* ---- server factory (one instance per stateless HTTP request) ------------- */
export function createMcpServer(keyContext: McpKeyContext): McpServer {
  const server = new McpServer({ name: 'spms', version: '0.1.0' });

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
        sprint: z.string().optional().describe('迭代 id（按关联迭代过滤）'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        return requirementSvc.listRequirements(actor, { project: args.project, type: args.type, sprint: args.sprint });
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
      description: `迭代详情：元信息 + committed issue 列表 + 关联需求列表 + committed/completed/remaining 点数统计。id 从 spms_list_sprints 获得。${CONCEPTS}`,
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
      description: `启动迭代（planned → active）。迭代可包含多个项目；任一项目已有其他进行中的迭代时冲突报错。id 从 spms_list_sprints 获得。${CONCEPTS}`,
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
      description: `完成迭代（active → completed）。未完成（非 done/canceled）的 Issue 自动移回产品待办，未交付（非 shipped/rejected）的需求同样退出迭代，返回 { sprint, movedCount }（两者合计）。${CONCEPTS}`,
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
    'spms_list_plans',
    {
      description:
        `开发计划列表（按创建时间倒序），project 传项目 id（uuid）过滤。返回的 id 字段是展示 key（PLAN-N），` +
        `requirements 为关联需求展示 key 数组（FR-N / NFR-N）；status：draft=待生成 / generated=已生成。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
      inputSchema: {
        companyId: companyIdParam,
        project: z.string().optional().describe('项目 id（uuid）'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        return planSvc.listPlans(actor, { project: args.project });
      }),
  );

  reg(
    'spms_get_plan',
    {
      description: `开发计划详情：markdown 正文 content / 模板 templateMd / 关联需求，按展示 key（如 PLAN-1）查询。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
      inputSchema: {
        companyId: companyIdParam,
        key: z.string().describe("开发计划展示 key，如 'PLAN-1'"),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        return found(await planSvc.getPlan(actor, args.key), 'PLAN_NOT_FOUND', `开发计划 ${args.key} 不存在`);
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
        `sprint 包含项目（可多项目）时，issue 的项目必须在其中（冲突报 LIFECYCLE_MISMATCH）；` +
        `未传 projectId 且 sprint 恰好一个项目时自动归属该项目。${CONCEPTS}`,
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
    'spms_review_issue',
    {
      description:
        `功能审查（工作流入口）：处理任何 issue/需求前必须先调用本工具完成审查——工单审查是否已实现，BUG 审查是否可复现。` +
        `对 issue（TKT/BUG/BLG key）：verdict='passed'（工单未实现需开发 / BUG 可复现需修复）→ 状态自动置 in_progress；` +
        `verdict='already_done'（工单已实现 / 无需修改）→ 状态自动置 testing 并自动指派测试人员` +
        `（优先当前项目资源池中公司角色为 tester 的成员；没有则回退 agent 成员中 role='test' 者，内置为 Sentry；都找不到则不指派并在返回中说明）；` +
        `verdict='failed'（BUG 不可复现等）→ 只写评论、状态不变，返回的 suggestion 给出后续建议。` +
        `对需求（FR/NFR key）：verdict='passed' → 状态自动置 in_dev；其余 verdict 状态不变（需求无评论能力，note 不落库）。` +
        `note 会写为 issue 评论。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        key: z.string().describe("Issue 或需求展示 key，如 'TKT-6'、'BUG-3'、'FR-2'"),
        verdict: z
          .enum(['passed', 'failed', 'already_done'])
          .describe('审查结论：passed=工单未实现需开发/BUG 可复现需修复；already_done=已实现/无需修改；failed=不可复现/未通过'),
        note: z.string().optional().describe('审查备注，写为 issue 评论（需求无评论能力，不落库）'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        return reviewWithWorkflow(actor, args.key, args.verdict, args.note);
      }),
  );

  reg(
    'spms_update_issue',
    {
      description:
        `更新 Issue（按展示 key，如 BUG-3）：可改 status/priority/importance/title/description/assigneeId/projectId/` +
        `requirementId（展示 key）/sprintId/estimate/storyPoints/labels（全量替换）。只传要改的字段；显式传 null 可清空可空字段。` +
        `工作流自动化：status 传 'done' 会被拦截并实际落库为 'testing'（开发完成需测试验证，不直接关单），此时若未显式传 assigneeId ` +
        `会自动指派测试人员（优先当前项目资源池中公司角色为 tester 的成员；没有则回退 agent 成员中 role='test' 者，内置为 Sentry）并自动写一条说明评论；` +
        `status 传 'testing' 且未传 assigneeId 时同样自动指派测试人员。处理 issue 前请先调用 spms_review_issue 完成功能审查。${CONCEPTS}`,
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
        return updateIssueWithWorkflow(actor, key, input);
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
        `典型用法：Agent 完成任务后先调用本工具上传结果截图，再调用 spms_update_issue 把 status 置为 'done'（自动流转为 testing 并指派测试人员）。${CONCEPTS}`,
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
        `releaseId 传版本 id（spms_get_bootstrap 的 releases）。sprintId 可直接把需求关联到迭代（纯 AI 开发场景可不拆 issue、直接按需求开发；` +
        `迭代包含项目时需求的项目必须在其中，冲突报 LIFECYCLE_MISMATCH）；assigneeId 传负责人 member id。${CONCEPTS}`,
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
        sprintId: z.string().optional().describe('迭代 id（直接关联到迭代）'),
        assigneeId: z.string().optional().describe('负责人 member id'),
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
        `acceptanceCriteria/releaseId/sprintId/assigneeId/projectId/position。sprintId 关联/移出迭代（null 移出；` +
        `迭代包含项目时需求的项目必须在其中，冲突报 LIFECYCLE_MISMATCH）；assigneeId 传负责人 member id（null 取消指派）。` +
        `需求状态：draft|reviewing|approved|in_dev|shipped|rejected。只传要改的字段。${CONCEPTS}`,
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
        sprintId: z.string().nullable().optional().describe('迭代 id；null 移出迭代'),
        assigneeId: z.string().nullable().optional().describe('负责人 member id；null 取消指派'),
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
    'spms_decompose_requirement',
    {
      description:
        `把需求拆解为工单：按验收标准逐行（为空则回退 PRD 描述逐行）批量创建 TKT 并关联回该需求，` +
        `继承需求的项目/紧急度/重要度，一次最多 20 条、key 连号；首个工单开工时需求自动转 in_dev。` +
        `验收标准和描述均为空（没有可拆分内容）时报 VALIDATION_FAILED。返回创建的 issue 列表。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        key: z.string().describe("需求展示 key，如 'FR-2' 或 'NFR-1'"),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        return requirementSvc.decomposeRequirement(actor, args.key);
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
        `迭代包含项目（可多项目）时 issue 的项目必须在其中，否则报 LIFECYCLE_MISMATCH；` +
        `issue 无项目且迭代恰好一个项目时自动归属。可同时更新 storyPoints。${CONCEPTS}`,
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

  reg(
    'spms_update_project',
    {
      description:
        `更新项目（按 uuid id，spms_get_bootstrap / spms_list_projects 可查）：可改 name/releaseId（换绑版本即调整关联）/` +
        `status/leadId/aiLeadId/icon/color/target/description/summary/goal/nonGoals。` +
        `status：backlog|planned|in_progress|completed。只传要改的字段。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        id: z.string().describe('项目 id（uuid）'),
        name: z.string().optional(),
        releaseId: z.string().nullable().optional().describe('版本/Release id；null 解除关联'),
        status: projectStatus.optional(),
        leadId: z.string().nullable().optional().describe('负责人 member id'),
        aiLeadId: z.string().nullable().optional().describe('AI 负责人 member id'),
        icon: z.string().optional(),
        color: z.string().optional(),
        target: z.string().nullable().optional().describe('目标说明'),
        description: z.string().nullable().optional().describe('项目描述'),
        summary: z.string().nullable().optional().describe('基本信息-概述'),
        goal: z.string().nullable().optional().describe('基本信息-目标'),
        nonGoals: z.string().nullable().optional().describe('基本信息-非目标'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        const { companyId: _companyId, id, ...input } = args;
        return projectSvc.updateProject(actor, id, input);
      }),
  );

  reg(
    'spms_create_plan',
    {
      description:
        `创建开发计划（自动分配 PLAN-N key，初始 status=draft 待生成、content 为空）。projectId 传项目 id（uuid）；` +
        `requirementIds 传关联需求展示 key 数组（FR-N / NFR-N，未知 key 报 VALIDATION_FAILED）；templateMd 传 markdown 模板文本。` +
        `典型用法：先建壳并关联需求，由 Agent 生成内容后调用 spms_update_plan 写入 content 并把 status 置为 'generated'。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        projectId: z.string().describe('项目 id（uuid，必填）'),
        title: z.string().describe('计划标题（必填）'),
        requirementIds: z.array(z.string()).max(50).optional().describe("关联需求展示 key 数组，如 ['FR-2', 'NFR-1']"),
        templateMd: z.string().optional().describe('markdown 模板文本（Agent 生成时遵循其结构）'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        const { companyId: _companyId, ...input } = args;
        return planSvc.createPlan(actor, input);
      }),
  );

  reg(
    'spms_update_plan',
    {
      description:
        `更新开发计划（按展示 key，如 PLAN-1）：可改 title/content（markdown 正文）/templateMd/status/requirementIds。` +
        `status：draft=待生成 / generated=已生成；requirementIds 传了即全量替换关联（元素为需求展示 key）。` +
        `Agent「生成」开发计划的标准动作：写入 content 并把 status 置为 'generated'。只传要改的字段。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        key: z.string().describe("开发计划展示 key，如 'PLAN-1'"),
        title: z.string().optional(),
        content: z.string().optional().describe('markdown 正文'),
        templateMd: z.string().nullable().optional().describe('markdown 模板文本；null 清空'),
        status: planStatus.optional().describe('draft=待生成 / generated=已生成'),
        requirementIds: z.array(z.string()).max(50).optional().describe('关联需求展示 key 数组；传了即全量替换'),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        const { companyId: _companyId, key, ...input } = args;
        return planSvc.updatePlan(actor, key, input);
      }),
  );

  reg(
    'spms_update_release',
    {
      description:
        `更新版本/Release（按 id，spms_get_bootstrap 的 releases 可查）：可改 name/description/status/phase/` +
        `targetDate/progress/position。status：planned|in_progress|released|deprecated；` +
        `phase 为产品生命周期段（concept 构思→development 开发→release 发布→maintenance 维护→retired 退役），` +
        `项目卡片的生命周期进度条读它。只传要改的字段。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        id: z.string().describe('版本/Release id'),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        status: releaseStatus.optional(),
        phase: lifecyclePhase.optional().describe('产品生命周期段'),
        targetDate: z.string().nullable().optional().describe('目标日期（ISO），传 null 清空'),
        progress: z.number().min(0).max(1).optional().describe('进度 0–1'),
        position: z.number().optional(),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        const { companyId: _companyId, id, ...input } = args;
        return catalogSvc.updateRelease(actor, id, input);
      }),
  );

  reg(
    'spms_create_product',
    {
      description:
        `创建产品（自动分配 PD-N key）。productLineId 传产品线 id（产品挂在产品线下，spms_get_bootstrap 的 productLines 可查）；` +
        `leadId 传负责人 member id（spms_list_members 可查）。产品下的版本/Release 用 spms_update_release 维护。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        productLineId: z.string().describe('产品线 id（必填，产品关联到该产品线）'),
        name: z.string().describe('产品名称（必填）'),
        description: z.string().optional().describe('产品描述'),
        icon: z.string().optional().describe("图标名，默认 'box'"),
        color: z.string().optional().describe('颜色（#RRGGBB）'),
        status: productStatus.optional().describe("默认 'active'"),
        leadId: z.string().optional().describe('负责人 member id'),
        position: z.number().optional(),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        const { companyId: _companyId, ...input } = args;
        return catalogSvc.createProduct(actor, input);
      }),
  );

  reg(
    'spms_update_product',
    {
      description:
        `更新产品（按 uuid id，spms_get_bootstrap 的 products 可查）：可改 name/description/icon/color/status/leadId/position/` +
        `productLineId（换绑产品线即调整关联）。status：active|maintenance|archived。只传要改的字段。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        id: z.string().describe('产品 id（uuid）'),
        productLineId: z.string().optional().describe('换绑到的产品线 id'),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        icon: z.string().optional(),
        color: z.string().optional(),
        status: productStatus.optional(),
        leadId: z.string().nullable().optional().describe('负责人 member id'),
        position: z.number().optional(),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        const { companyId: _companyId, id, ...input } = args;
        return catalogSvc.updateProduct(actor, id, input);
      }),
  );

  reg(
    'spms_submit_report',
    {
      description:
        `按项目提交本人日报（合并式 upsert：服务端按 项目→版本→产品 推导日报归属产品；` +
        `同日重复提交同一产品时，默认把新内容追加到该产品已有条目末尾、不覆盖已有内容（除非调用方显式传 mode='replace'），` +
        `不影响当日其他产品的条目，返回的 created/updated 标明各产品条目是新建还是更新）。` +
        `entries 的 project 接受项目 id 或项目名（精确匹配，spms_get_bootstrap 的 projects 可查）；` +
        `项目必须在令牌的项目白名单内（令牌未设白名单则不限）；项目需已关联版本，否则无法推导产品。` +
        `content 会规整为简单 Markdown（已是列表/标题/代码围栏的行保留，其余非空行转为 \`- \` 列表项），日报汇总视图按 Markdown 渲染。` +
        `content 写作要求：只需把相关 issue 的标题或内容简化总结、说清楚做了什么即可，不要额外的铺垫、评价或展开描述。` +
        `典型场景：Agent 按 git 提交记录按项目汇总出条目后逐项目上报，多个项目/token 分别上报不会互相覆盖。` +
        `作者固定为令牌所属人（所属人无公司席位则报错），不接受任何 memberId 参数，不能代他人提交。${CONCEPTS}`,
      inputSchema: {
        companyId: companyIdParam,
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
          .describe('日报日期（客户端本地日历日，YYYY-MM-DD）'),
        entries: z
          .array(
            z.object({
              project: z.string().min(1).describe('项目 id 或项目名（精确匹配）'),
              content: z.string().min(1).max(reportSvc.MAX_CONTENT_LEN).describe(`该项目（推导到产品）下的日报内容（≤${reportSvc.MAX_CONTENT_LEN} 字）`),
            }),
          )
          .min(1)
          .describe('按项目拆分的日报条目（推导到同一产品的多个项目请先自行合并内容，一次提交内同一产品只能出现一次）'),
        mode: z
          .enum(['append', 'replace'])
          .optional()
          .describe("已存在同日同产品条目时的处理方式：append（默认）追加到已有内容末尾；replace 整体替换（仅用户明确要求覆盖时使用）"),
      },
    },
    async (args) =>
      run(async () => {
        const actor = await actorFor(args.companyId);
        // 项目解析：公司内先按 id 再按 name 精确匹配（projects 表无 key 列）。
        const wanted = [...new Set(args.entries.map((e) => e.project))];
        const projRows = await db
          .select({ id: projects.id, name: projects.name, releaseId: projects.releaseId })
          .from(projects)
          .where(and(eq(projects.companyId, actor.companyId), or(inArray(projects.id, wanted), inArray(projects.name, wanted))));
        const byId = new Map(projRows.map((r) => [r.id, r]));
        const byName = new Map(projRows.map((r) => [r.name, r]));
        const resolved = args.entries.map((e) => {
          const proj = byId.get(e.project) ?? byName.get(e.project);
          if (!proj) throw new ApiException('PROJECT_NOT_FOUND', `项目 ${e.project} 不存在`);
          return { proj, content: e.content };
        });
        // 令牌项目白名单强制收窄（与 issue 写操作同规则）。
        if (actor.allowedProjectIds) {
          for (const { proj } of resolved) {
            if (!actor.allowedProjectIds.includes(proj.id)) {
              throw new ApiException('FORBIDDEN', `项目 ${proj.name} 不在令牌的项目白名单内`, 403);
            }
          }
        }
        // 产品推导：项目 → releaseId → releases.productId。
        const releaseIds = [...new Set(resolved.map((r) => r.proj.releaseId).filter((x): x is string => x != null))];
        const releaseRows = releaseIds.length
          ? await db
              .select({ id: releases.id, productId: releases.productId })
              .from(releases)
              .where(and(eq(releases.companyId, actor.companyId), inArray(releases.id, releaseIds)))
          : [];
        const productIdByRelease = new Map(releaseRows.map((r) => [r.id, r.productId]));
        const productIdByProject = new Map<string, string>();
        for (const { proj } of resolved) {
          if (!proj.releaseId) {
            throw new ApiException('VALIDATION_FAILED', `项目 ${proj.name} 未关联版本，无法推导产品`);
          }
          const productId = productIdByRelease.get(proj.releaseId);
          if (!productId) throw new ApiException('VALIDATION_FAILED', `项目 ${proj.name} 关联的版本不存在，无法推导产品`);
          productIdByProject.set(proj.id, productId);
        }
        // 一次调用内两个项目推导到同一产品 → 要求调用方先合并内容。
        const firstProjectByProduct = new Map<string, string>();
        for (const { proj } of resolved) {
          const productId = productIdByProject.get(proj.id)!;
          const first = firstProjectByProduct.get(productId);
          if (first) {
            throw new ApiException(
              'VALIDATION_FAILED',
              `项目 ${first} 与项目 ${proj.name} 推导到同一产品，请先合并内容再提交（同一产品一次提交只能出现一次）`,
            );
          }
          firstProjectByProduct.set(productId, proj.name);
        }
        const entries = resolved.map((r) => ({
          productId: productIdByProject.get(r.proj.id)!,
          // 上报内容规整为简单 Markdown（普通行 → `- ` 列表项），汇总视图按 Markdown 渲染。
          content: formatReportContent(r.content),
        }));
        const { report, created, updated } = await reportSvc.mergeMyReportEntries(actor, args.date, entries, { mode: args.mode });
        // created/updated 以产品 key/name 标注，便于调用方确认推导结果。
        const productIds = [...created, ...updated];
        const prodRows = productIds.length
          ? await db
              .select({ id: products.id, key: products.key, name: products.name })
              .from(products)
              .where(and(eq(products.companyId, actor.companyId), inArray(products.id, productIds)))
          : [];
        const prodById = new Map(prodRows.map((r) => [r.id, r]));
        const label = (id: string) => {
          const p = prodById.get(id);
          return p ? `${p.key}（${p.name}）` : id;
        };
        return {
          ...report,
          created: created.map(label),
          updated: updated.map(label),
          note: '合并提交：同日重复提交同一产品会更新该产品条目，不影响其他产品',
        };
      }),
  );

  return server;
}
