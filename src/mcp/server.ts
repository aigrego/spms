import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { labels, members, productLines, products, projects, releases, sprints, teams } from '@/db/schema';
import { ApiException, type ErrorCode } from '@/lib/envelope';
import { ensureAgents } from '@/lib/identity';
import { computeRollups } from '@/lib/rollup';
import * as issueSvc from '@/server/services/issues';
import * as projectSvc from '@/server/services/projects';
import * as requirementSvc from '@/server/services/requirements';
import * as resourceSvc from '@/server/services/resources';
import * as sprintSvc from '@/server/services/sprints';
import * as testCaseSvc from '@/server/services/testcases';
import type { Actor } from '@/server/services/types';

/* MCP server (Phase D) — a thin adapter over src/server/services/*. Tools share
   the exact business rules of the REST API; this file only does zod validation,
   actor resolution, and result/error wrapping. See docs/MCP.md for the tool
   contract. Stateless: a fresh McpServer is created per HTTP request. */

/* ---- MCP 操作者身份 -------------------------------------------------------
   All writes are attributed to the built-in `scribe` agent member so the
   activity feed shows them as Agent operations (docs/MCP.md §操作者身份). */
async function mcpActor(): Promise<Actor> {
  await ensureAgents(); // fallback for an empty database
  const [scribe] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.agentKey, 'scribe'))
    .limit(1);
  if (!scribe) throw new Error('scribe agent member missing after ensureAgents()');
  return { userId: 'mcp', memberId: scribe.id, name: 'MCP Agent', role: 'admin' };
}

/* ---- bootstrap payload ----------------------------------------------------
   Mirrors services/meta.bootstrap minus ensureCurrentMember(): the MCP actor
   has no users row, and calling it with a synthetic id would insert a bogus
   human member into the resource pool. */
async function loadBootstrap() {
  await ensureAgents();
  const [memberRows, teamRows, labelRows, projectRows, sprintRows, productLineRows, productRows, releaseRows] =
    await Promise.all([
      db.select().from(members),
      db.select().from(teams),
      db.select().from(labels),
      db.select().from(projects),
      db.select().from(sprints).orderBy(asc(sprints.startDate)),
      db.select().from(productLines).orderBy(asc(productLines.position)),
      db.select().from(products).orderBy(asc(products.position)),
      db.select().from(releases).orderBy(asc(releases.position)),
    ]);
  // Project/release progress is derived from issue completion, not the stored column.
  const { projectProgress, releaseProgress } = await computeRollups();
  return {
    members: memberRows,
    teams: teamRows,
    labels: labelRows,
    projects: projectRows.map((p) => ({ ...p, progress: projectProgress.get(p.id) ?? 0 })),
    sprints: sprintRows,
    productLines: productLineRows,
    products: productRows,
    releases: releaseRows.map((r) => ({ ...r, progress: releaseProgress.get(r.id) ?? 0 })),
  };
}

/* ---- result / error wrapping --------------------------------------------- */
type ToolText = { type: 'text'; text: string };

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

/* ---- zod enums (aligned with src/db/schema.ts pgEnum values) -------------- */
const issueStatus = z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled']);
const issuePriority = z.enum(['urgent', 'high', 'medium', 'low', 'none']);
const issueImportance = z.enum(['critical', 'high', 'medium', 'low', 'none']);
const issueType = z.enum(['backlog', 'ticket', 'bug']);
const requirementType = z.enum(['functional', 'non_functional']);
const requirementCategory = z.enum(['performance', 'security', 'usability', 'reliability', 'compatibility', 'maintainability']);
const requirementStatus = z.enum(['draft', 'reviewing', 'approved', 'in_dev', 'shipped', 'rejected']);
const testCaseStatus = z.enum(['draft', 'active', 'deprecated']);
const testResult = z.enum(['untested', 'passed', 'failed', 'blocked']);

const CONCEPTS = [
  '概念：Issue 是统一工作项，type=bug 即缺陷、ticket 即工单/任务、backlog 即备忘。',
  '所有实体用展示 key 引用（BUG-3 / TKT-7 / FR-2 / NFR-1 / TC-1），内部 uuid 不暴露。',
  'issue 状态枚举：backlog|todo|in_progress|in_review|done|canceled；需求状态：draft|reviewing|approved|in_dev|shipped|rejected。',
  'priority（紧急度）：urgent|high|medium|low|none；importance（重要度）：critical|high|medium|low|none，两者正交。',
  '成员（member）分 human 与 agent（atlas/forge/sentry/scribe 四个内置 AI），assigneeId 用 member id，issue 可指派给 agent。',
].join(' ');

/* ---- server factory (one instance per stateless HTTP request) ------------- */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'next-spms', version: '0.1.0' });

  /* ================= 读 ================= */

  server.registerTool(
    'spms_get_bootstrap',
    {
      description:
        `全量参考数据：members（含 agent 成员及其 id）/labels/projects（含派生进度）/sprints/productLines/products/releases。` +
        `建议会话开始时调用一次，拿到项目 id、迭代 id、成员 id、label id 供后续工具使用。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
    },
    async () => run(loadBootstrap),
  );

  server.registerTool(
    'spms_list_issues',
    {
      description:
        `Issue 列表，筛选均可选。type='bug' 即缺陷列表。返回的 id 字段是展示 key（如 BUG-3）。` +
        `assignee/project/sprint 传对应 id（id 可从 spms_get_bootstrap 获得）。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
      inputSchema: {
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
        // The service natively filters by assignee/project; the rest are
        // post-filtered on the serialized rows (id there is the display key).
        const rows = await issueSvc.listIssues({ assignee: args.assignee, project: args.project });
        return rows.filter(
          (r) =>
            (args.status === undefined || r.status === args.status) &&
            (args.type === undefined || r.type === args.type) &&
            (args.priority === undefined || r.priority === args.priority) &&
            (args.sprint === undefined || r.sprintId === args.sprint),
        );
      }),
  );

  server.registerTool(
    'spms_get_issue',
    {
      description: `Issue 详情：按展示 key（如 BUG-3）查询，含 labels/subIssues/activities（created/status/comment 等历史流）。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
      inputSchema: { key: z.string().describe("Issue 展示 key，如 'BUG-3'") },
    },
    async (args) =>
      run(async () => found(await issueSvc.getIssue(args.key), 'ISSUE_NOT_FOUND', `Issue ${args.key} 不存在`)),
  );

  server.registerTool(
    'spms_list_requirements',
    {
      description: `需求列表（附关联 issue 完成度）。返回的 id 字段是展示 key（FR-N / NFR-N）。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
      inputSchema: {
        project: z.string().optional().describe('项目 id'),
        type: requirementType.optional().describe('functional=功能需求 / non_functional=非功能需求'),
      },
    },
    async (args) => run(() => requirementSvc.listRequirements({ project: args.project, type: args.type })),
  );

  server.registerTool(
    'spms_get_requirement',
    {
      description: `需求详情：PRD 描述/验收标准/关联 issue 列表，按展示 key（如 FR-2）查询。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
      inputSchema: { key: z.string().describe("需求展示 key，如 'FR-2' 或 'NFR-1'") },
    },
    async (args) =>
      run(async () =>
        found(await requirementSvc.getRequirement(args.key), 'REQUIREMENT_NOT_FOUND', `需求 ${args.key} 不存在`),
      ),
  );

  server.registerTool(
    'spms_list_projects',
    {
      description: `项目列表（含按 issue 完成度派生的 progress）。项目用 uuid id 引用。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
    },
    async () => run(async () => (await loadBootstrap()).projects),
  );

  server.registerTool(
    'spms_list_sprints',
    {
      description: `迭代列表（按开始日期升序）。迭代用 uuid id 引用。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
    },
    async () => run(() => sprintSvc.listSprints()),
  );

  server.registerTool(
    'spms_get_sprint',
    {
      description: `迭代详情：元信息 + committed issue 列表 + committed/completed/remaining 点数统计。id 从 spms_list_sprints 获得。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
      inputSchema: { id: z.string().describe('迭代 id（uuid）') },
    },
    async (args) =>
      run(async () => found(await sprintSvc.getSprint(args.id), 'SPRINT_NOT_FOUND', `迭代 ${args.id} 不存在`)),
  );

  server.registerTool(
    'spms_list_test_cases',
    {
      description: `测试用例列表。status：draft|active|deprecated；result：untested|passed|failed|blocked。requirement 传展示 key（FR-N）。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
      inputSchema: {
        project: z.string().optional().describe('项目 id'),
        requirement: z.string().optional().describe("需求展示 key，如 'FR-2'"),
        status: testCaseStatus.optional(),
        result: testResult.optional(),
      },
    },
    async (args) => run(() => testCaseSvc.listTestCases(args)),
  );

  server.registerTool(
    'spms_list_members',
    {
      description: `成员列表（human/agent，含 id、agentKey、状态）。assigneeId、leadId 等参数从这里取 member id。${CONCEPTS}`,
      annotations: { readOnlyHint: true },
    },
    async () => run(() => resourceSvc.listMembers()),
  );

  /* ================= 写 ================= */

  server.registerTool(
    'spms_create_issue',
    {
      description:
        `创建 Issue。创建缺陷传 type='bug'（返回 key 形如 BUG-N）；工单/任务 type='ticket'（默认）；备忘 type='backlog'。` +
        `requirementId 传需求展示 key（FR-N）；assigneeId/projectId/sprintId/labels 传对应 id（spms_get_bootstrap 可查）。` +
        `sprint 属于某个项目时，issue 会自动归属该项目（projectId 冲突会报 LIFECYCLE_MISMATCH）。${CONCEPTS}`,
      inputSchema: {
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
    async (args) => run(async () => issueSvc.createIssue(await mcpActor(), args)),
  );

  server.registerTool(
    'spms_update_issue',
    {
      description:
        `更新 Issue（按展示 key，如 BUG-3）：可改 status/priority/importance/title/description/assigneeId/projectId/` +
        `requirementId（展示 key）/sprintId/estimate/storyPoints/labels（全量替换）。只传要改的字段；显式传 null 可清空可空字段。${CONCEPTS}`,
      inputSchema: {
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
        const { key, ...input } = args;
        return issueSvc.updateIssue(await mcpActor(), key, input);
      }),
  );

  server.registerTool(
    'spms_add_comment',
    {
      description: `给 Issue 加评论（写入 activities 流，kind=comment，操作者为 MCP Agent/scribe）。${CONCEPTS}`,
      inputSchema: {
        key: z.string().describe("Issue 展示 key，如 'BUG-3'"),
        body: z.string().describe('评论内容（不能为空）'),
      },
    },
    async (args) => run(async () => issueSvc.addComment(await mcpActor(), args.key, args.body)),
  );

  server.registerTool(
    'spms_create_requirement',
    {
      description:
        `创建需求（自动分配 key：functional→FR-N，non_functional→NFR-N）。category 仅对 non_functional 有意义。` +
        `releaseId 传版本 id（spms_get_bootstrap 的 releases）。${CONCEPTS}`,
      inputSchema: {
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
    async (args) => run(async () => requirementSvc.createRequirement(await mcpActor(), args)),
  );

  server.registerTool(
    'spms_update_requirement',
    {
      description:
        `更新需求（按展示 key，如 FR-2）：可改 status/title/type/category/priority/importance/description/` +
        `acceptanceCriteria/releaseId/projectId/position。需求状态：draft|reviewing|approved|in_dev|shipped|rejected。只传要改的字段。${CONCEPTS}`,
      inputSchema: {
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
        const { key, ...input } = args;
        return requirementSvc.updateRequirement(key, input);
      }),
  );

  server.registerTool(
    'spms_create_test_case',
    {
      description: `创建测试用例（自动分配 TC-N key，初始 status=draft、result=untested）。requirementId 传需求展示 key（FR-N）。${CONCEPTS}`,
      inputSchema: {
        projectId: z.string().describe('项目 id（必填）'),
        title: z.string().describe('用例标题（必填）'),
        requirementId: z.string().optional().describe("需求展示 key，如 'FR-2'"),
        priority: issuePriority.optional(),
        preconditions: z.string().optional().describe('前置条件'),
        steps: z.string().optional().describe('测试步骤'),
        expected: z.string().optional().describe('预期结果'),
      },
    },
    async (args) => run(async () => testCaseSvc.createTestCase(await mcpActor(), args)),
  );

  server.registerTool(
    'spms_update_test_case',
    {
      description:
        `更新测试用例（按展示 key，如 TC-1）：可改 title/priority/status（draft|active|deprecated）/result（untested|passed|failed|blocked）/` +
        `preconditions/steps/expected/requirementId（展示 key）/assigneeId/position。执行结果用 result 字段记录。只传要改的字段。${CONCEPTS}`,
      inputSchema: {
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
        const { key, ...input } = args;
        return testCaseSvc.updateTestCase(key, input);
      }),
  );

  server.registerTool(
    'spms_move_issue_to_sprint',
    {
      description:
        `把 Issue 移入/移出迭代。sprintId 传迭代 id，或 '_backlog' 移出迭代（回到产品待办）。` +
        `迭代属于项目时 issue 自动归属该项目。可同时更新 storyPoints。${CONCEPTS}`,
      inputSchema: {
        sprintId: z.string().describe("迭代 id，或 '_backlog' 移出迭代"),
        issueKey: z.string().describe("Issue 展示 key，如 'BUG-3'"),
        storyPoints: z.number().nullable().optional().describe('可选，同时更新故事点'),
      },
    },
    async (args) => run(() => sprintSvc.moveIssue(args.sprintId, args.issueKey, args.storyPoints)),
  );

  server.registerTool(
    'spms_create_project',
    {
      description: `创建项目（初始 status=backlog）。releaseId 传版本 id、leadId 传负责人 member id（spms_get_bootstrap / spms_list_members 可查）。${CONCEPTS}`,
      inputSchema: {
        name: z.string().describe('项目名称（必填）'),
        releaseId: z.string().optional().describe('版本/Release id'),
        leadId: z.string().optional().describe('负责人 member id'),
        target: z.string().optional().describe('目标说明'),
        description: z.string().optional().describe('项目描述'),
      },
    },
    async (args) => run(async () => projectSvc.createProject(await mcpActor(), args)),
  );

  return server;
}
