# spms MCP 服务

HTTP Streamable MCP 端点，供 Agent 连接并读取/处理需求、任务、缺陷等。
实现：`@modelcontextprotocol/sdk` 的 `StreamableHTTPServerTransport`，挂在 Next.js `/mcp` 路由（处理 POST/GET/DELETE）。

## 接入

- **URL**：`http://localhost:3000/mcp`
- **鉴权**：请求头 `Authorization: Bearer <key>`，按以下顺序判定：
  1. **DB key**（推荐）：sha256(key) 命中 `mcp_api_keys.keyHash` 且未吊销、未过期。任何登录用户都可在侧边栏 **Agent 接入**（`/agent-access`）自助签发自己的 key（或 `POST /api/v1/platform/mcp-keys`）：普通成员只能签所属公司范围的公司级 key（省略 companyId = 当前公司），平台级 key 仍仅平台管理员可签。**明文仅签发时返回一次**，库里只存哈希与前 8 位 prefix。

### key 能力、有效期与使用记录

- **能力上限**（`capabilities`，逗号分隔）：`read` = 13 个只读工具（`spms_list_*` / `spms_get_*` / `spms_get_bootstrap`）；`write` = 21 个写工具；`delete` 预留（当前无删除类工具）。调用超出能力的工具返回 `FORBIDDEN` 工具错误，不执行。
- **有效期**（`expiresAt`，NULL = 永久）：到期后鉴权直接 401，无需吊销。
- **最近使用**（`lastUsedAt`）：每次通过 MCP 鉴权时刷新（60s 节流），在令牌列表展示。
  2. **env 兜底**：未命中 DB 时回退到 env `MCP_API_KEY`（逗号分隔多个），一律视为**平台级** key（开发兼容）。
  3. 浏览器登录 session 也可访问（便于调试），操作范围 = 会话当前公司。

### key 级别与公司隔离

| key 级别 | 判定 | 数据范围 |
|---|---|---|
| 公司级 | `mcp_api_keys.companyId` 非空 | 钉死该公司沙箱，所有工具只读写本公司数据（自动隔离） |
| 平台级 | `companyId` NULL（含 env key） | 可跨公司：每个工具带可选 `companyId` 参数指定目标公司，**未传默认第一个公司**（createdAt 最早） |

客户端配置示例（Claude Code / 其他 MCP host，key 换成 /agent-access 签发的明文）：

```json
{
  "mcpServers": {
    "spms": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer <在 /agent-access 签发的 key>" }
    }
  }
}
```

## 概念说明（写给 Agent 的工具描述要点）

- **Issue 是统一工作项**：`type: 'bug'` = 缺陷，`'ticket'` = 工单/任务，`'backlog'` = 备忘
- 所有实体用**展示 key** 引用：`BUG-3`、`TKT-7`、`FR-2`、`TC-1`、`PLAN-1`、`PL-1`/`PD-1`/`RL-1`（内部 uuid 不暴露）
- 状态枚举：issue 与需求相同，均为 `backlog|todo|in_progress|testing|done|canceled`（需求复用 issue_status 枚举）
- 优先级 `urgent|high|medium|low|none`（紧急度）与重要度 `critical|high|medium|low|none` 正交
- 成员分 `human` 与 `agent`（atlas/forge/sentry/scribe 四个内置 AI），issue 可指派给 agent
- 列表默认排除**已归档** issue 及已归档项目的 issue（与 UI 一致；归档/取消归档暂只支持 UI/REST）

## Tools

共 **34 个**（读 13 + 写 21）。平台级 key 的每个工具都带可选 `companyId` 参数（公司级 key 与浏览器 session 忽略之）。

### 读

| Tool | 参数 | 说明 |
|---|---|---|
| `spms_get_bootstrap` | — | 全量参考数据（members/labels/projects/sprints/产品线/产品/版本 + currentCompany） |
| `spms_list_companies` | — | **新增**：公司列表（id/key/name/description）；公司级 key 只返回本公司 |
| `spms_list_issues` | `status? type? priority? assignee? project? sprint?` | Issue 列表（筛选均可选；type=bug 即缺陷列表） |
| `spms_get_issue` | `key` | Issue 详情（含 labels/subIssues/activities 评论流/attachments 附件）；图片附件同时以 image 内容块返回，Agent 可直接看图识别 |
| `spms_list_requirements` | `project? type? sprint?` | 需求列表（附关联 issue 完成度） |
| `spms_get_requirement` | `key` | 需求详情（PRD 描述/验收标准/关联 issue） |
| `spms_list_projects` | — | 项目列表（含派生进度） |
| `spms_list_sprints` | — | 迭代列表 |
| `spms_get_sprint` | `id` | 迭代详情（含关联需求列表 + committed/completed 点数统计） |
| `spms_list_test_cases` | `project? requirement? status? result?` | 测试用例列表 |
| `spms_list_plans` | `project?` | **新增**：开发计划列表（按创建时间倒序；requirements 为关联需求展示 key 数组） |
| `spms_get_plan` | `key` | **新增**：开发计划详情（markdown 正文/模板/关联需求） |
| `spms_list_members` | — | 成员列表（human/agent） |

### 写

| Tool | 参数 | 说明 |
|---|---|---|
| `spms_create_issue` | `title, type?, status?, priority?, importance?, description?, assigneeId?, projectId?, requirementId?, sprintId?, estimate?, storyPoints?, labels?` | 创建 issue（缺陷传 type='bug'）；返回展示 key |
| `spms_review_issue` | `key, verdict, note?` | **新增**：功能审查（工作流入口，处理任何 issue/需求前必须先调用）。`verdict='passed'` → issue/需求自动置 `in_progress`；`'already_done'` → 自动置 `testing` 并指派测试人员；`'failed'` → 只写评论、状态不变（需求无评论能力，状态不变），返回 `suggestion` 后续建议 |
| `spms_update_issue` | `key, ...任意可更新字段` | 改状态/指派/优先级/标题/描述等。`status='done'` 会被拦截并实际落库 `testing`，未显式传 `assigneeId` 时自动指派测试人员并写说明评论 |
| `spms_add_comment` | `key, body` | 给 issue 加评论 |
| `spms_upload_issue_attachment` | `key, filename, data, contentType?` | 上传图片附件（data 为 base64；≤10MB，jpeg/png/gif/webp/avif）。配合 `spms_update_issue`（status='done'）实现"传图并关单" |
| `spms_create_requirement` | `projectId, title, type?, category?, priority?, importance?, description?, acceptanceCriteria?, releaseId?, sprintId?, assigneeId?` | 创建需求（自动分配 FR/NFR key）；sprintId 直接关联迭代（纯 AI 开发可不拆 issue 按需求开发；迭代项目口径冲突报 LIFECYCLE_MISMATCH） |
| `spms_update_requirement` | `key, ...` | 更新需求；sprintId 关联/移出迭代（null 移出），assigneeId 指派负责人（null 取消）。`status='done'` 会被拦截并实际落库 `testing`，未显式传 `assigneeId` 时自动指派测试人员（需求无评论能力，拦截说明放在返回值的 `workflowNote` 字段） |
| `spms_decompose_requirement` | `key` | **新增**：把需求拆解为工单（按验收标准逐行、空则回退 PRD 描述逐行；继承项目/紧急度/重要度，一次最多 20 条、key 连号） |
| `spms_create_test_case` | `projectId, title, requirementId?, priority?, preconditions?, steps?, expected?` | 创建测试用例 |
| `spms_update_test_case` | `key, ...` | 更新用例（含 result: passed/failed/blocked） |
| `spms_move_issue_to_sprint` | `sprintId（或 '_backlog'）, issueKey, storyPoints?` | 移入/移出迭代 |
| `spms_start_sprint` | `id` | 启动迭代（planned → active；迭代可跨多项目，任一项目已有进行中迭代即冲突） |
| `spms_complete_sprint` | `id` | 完成迭代（active → completed；未完成 Issue 移回待办、未完成需求退出迭代，返回 movedCount 合计） |
| `spms_create_project` | `name, releaseId?, leadId?, target?, description?` | 创建项目 |
| `spms_update_project` | `id, name?, releaseId?, status?, leadId?, aiLeadId?, icon?, color?, target?, description?, summary?, goal?, nonGoals?` | **新增**：更新项目（releaseId 换绑版本即调整关联） |
| `spms_create_plan` | `projectId, title, requirementIds?, templateMd?` | **新增**：创建开发计划（自动 PLAN-N key，初始 draft/待生成；requirementIds 传需求展示 key 数组）。Agent 生成内容后调 `spms_update_plan` 写入 content 并置 `generated` |
| `spms_update_plan` | `key, title?, content?, templateMd?, status?, requirementIds?` | **新增**：更新开发计划（status：draft 待生成/generated 已生成；requirementIds 传了即全量替换关联）。「生成」= 写 content + 置 `generated` |
| `spms_update_release` | `id, name?, description?, status?, phase?, targetDate?, progress?, position?` | 更新版本；`phase` 为产品生命周期段（concept→development→release→maintenance→retired），项目卡片生命周期进度条读它 |
| `spms_create_product` | `productLineId, name, description?, icon?, color?, status?, leadId?, position?` | **新增**：创建产品（自动 PD-N key，productLineId 关联到产品线） |
| `spms_update_product` | `id, productLineId?, name?, description?, icon?, color?, status?, leadId?, position?` | **新增**：更新产品（productLineId 换绑产品线即调整关联；status：active/maintenance/archived） |
| `spms_submit_report` | `date, entries[{project, content}], mode?` | 按项目提交本人日报（合并式 upsert）：服务端按 项目→版本→产品 推导日报归属产品（项目需已关联版本），同日重复提交同一产品时默认把新内容**追加**到该产品已有条目末尾（`mode='replace'` 才整体替换）、不影响其他产品条目，返回 `created`/`updated` 标明各产品条目新建/更新。`project` 接受项目 id 或项目名（精确匹配），且必须在令牌的项目白名单内；一次调用内多个项目推导到同一产品需先自行合并内容。`content` 会规整为简单 Markdown（普通行自动转为 `- ` 列表项），日报汇总视图按 Markdown 渲染；内容只需把相关 issue 的标题/内容简化总结、说清楚即可，不要额外展开描述。作者固定为令牌所属人，不能代他人提交。典型场景：Agent 按 git 提交记录按项目汇总条目后逐项目上报，多项目/多令牌分别上报互不覆盖 |

写工具与 REST API 复用同一套 `src/server/services/*`，业务规则一致（如 sprint-project 一致性校验、REQUIREMENT_NOT_FOUND 等错误码原样抛出）。

## 工作流自动化（内置，无需显式提示词）

实现于 `src/mcp/workflow.ts`，状态/评论落库全部走 service 层，活动流记录与 REST/UI 一致。

- **处理前审查**：处理任何 issue/需求前必须先调 `spms_review_issue`——工单审查是否已实现，BUG 审查是否可复现。
  - issue（TKT/BUG/BLG key）：`passed` → 自动置 `in_progress`；`already_done` → 自动置 `testing` 并自动指派测试人员；`failed` → 只写评论、状态不变，返回 `suggestion` 给出后续建议。
  - 需求（FR/NFR key）：`passed` → 自动置 `in_progress`；`already_done` → 自动置 `testing` 并自动指派测试人员；`failed` → 状态不变（需求无评论能力，`note` 不落库）。
- **完成即流转**：`spms_update_issue` / `spms_update_requirement` 传 `status='done'` 会被拦截，实际落库为 `testing`（开发完成需测试验证，不直接关单）；未显式传 `assigneeId` 时自动指派测试人员（issue 自动写一条说明评论；需求无评论能力，说明放在返回值的 `workflowNote` 字段）。`status='testing'` 且未传 `assigneeId` 时同样自动指派。
- **测试人员**：本公司 `type='agent'`、`role='test'`、`status='active'` 的第一个成员（内置即 Sentry）；找不到则不指派，在返回结果与评论中说明。

## 操作者身份

- **DB key 调用**：Actor = 令牌的**所属人**（`ownerId`，默认创建人，可在 /agent-access 随时修改），companyRole = 所属人在目标公司的真实 membership 角色（平台管理员无 membership 时按 `company_admin`）。activities 的 `whoId` 记为所属人的 member id，"我的 issue"即所属人名下 issue；写操作同时受所属人 RBAC 角色（权限矩阵）与 key 能力上限双重约束。所属人不是目标公司成员且非平台管理员 → `FORBIDDEN`；所属人用户被删除 → `UNAUTHORIZED`。
- **env 兜底 key**：Actor = 目标公司的内置 `scribe` agent member，companyRole=company_admin（开发兼容的遗留行为）。
- **浏览器 session 调用**（调试）：Actor = 会话用户本人及其当前公司，权限与其 RBAC 角色一致。
