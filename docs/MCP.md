# next-spms MCP 服务

HTTP Streamable MCP 端点，供 Agent 连接并读取/处理需求、任务、缺陷等。
实现：`@modelcontextprotocol/sdk` 的 `StreamableHTTPServerTransport`，挂在 Next.js `/mcp` 路由（处理 POST/GET/DELETE）。

## 接入

- **URL**：`http://localhost:3000/mcp`
- **鉴权**：请求头 `Authorization: Bearer <key>`，按以下顺序判定：
  1. **DB key**（推荐）：sha256(key) 命中 `mcp_api_keys.keyHash` 且未吊销、未过期。任何登录用户都可在侧边栏 **Agent 接入**（`/agent-access`）自助签发自己的 key（或 `POST /api/v1/platform/mcp-keys`）：普通成员只能签所属公司范围的公司级 key（省略 companyId = 当前公司），平台级 key 仍仅平台管理员可签。**明文仅签发时返回一次**，库里只存哈希与前 8 位 prefix。

### key 能力、有效期与使用记录

- **能力上限**（`capabilities`，逗号分隔）：`read` = 11 个只读工具（`spms_list_*` / `spms_get_*` / `spms_get_bootstrap`）；`write` = 9 个写工具；`delete` 预留（当前无删除类工具）。调用超出能力的工具返回 `FORBIDDEN` 工具错误，不执行。
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
    "next-spms": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer <在 /agent-access 签发的 key>" }
    }
  }
}
```

## 概念说明（写给 Agent 的工具描述要点）

- **Issue 是统一工作项**：`type: 'bug'` = 缺陷，`'ticket'` = 工单/任务，`'backlog'` = 备忘
- 所有实体用**展示 key** 引用：`BUG-3`、`TKT-7`、`FR-2`、`TC-1`、`PL-1`/`PD-1`/`RL-1`（内部 uuid 不暴露）
- 状态枚举：issue `backlog|todo|in_progress|in_review|done|canceled`；需求 `draft|reviewing|approved|in_dev|shipped|rejected`
- 优先级 `urgent|high|medium|low|none`（紧急度）与重要度 `critical|high|medium|low|none` 正交
- 成员分 `human` 与 `agent`（atlas/forge/sentry/scribe 四个内置 AI），issue 可指派给 agent
- 列表默认排除**已归档** issue 及已归档项目的 issue（与 UI 一致；归档/取消归档暂只支持 UI/REST）

## Tools

共 **21 个**（读 11 + 写 10）。平台级 key 的每个工具都带可选 `companyId` 参数（公司级 key 与浏览器 session 忽略之）。

### 读

| Tool | 参数 | 说明 |
|---|---|---|
| `spms_get_bootstrap` | — | 全量参考数据（members/labels/projects/sprints/产品线/产品/版本 + currentCompany） |
| `spms_list_companies` | — | **新增**：公司列表（id/key/name/description）；公司级 key 只返回本公司 |
| `spms_list_issues` | `status? type? priority? assignee? project? sprint?` | Issue 列表（筛选均可选；type=bug 即缺陷列表） |
| `spms_get_issue` | `key` | Issue 详情（含 labels/subIssues/activities 评论流/attachments 附件）；图片附件同时以 image 内容块返回，Agent 可直接看图识别 |
| `spms_list_requirements` | `project? type?` | 需求列表（附关联 issue 完成度） |
| `spms_get_requirement` | `key` | 需求详情（PRD 描述/验收标准/关联 issue） |
| `spms_list_projects` | — | 项目列表（含派生进度） |
| `spms_list_sprints` | — | 迭代列表 |
| `spms_get_sprint` | `id` | 迭代详情（含 committed/completed 点数统计） |
| `spms_list_test_cases` | `project? requirement? status? result?` | 测试用例列表 |
| `spms_list_members` | — | 成员列表（human/agent） |

### 写

| Tool | 参数 | 说明 |
|---|---|---|
| `spms_create_issue` | `title, type?, status?, priority?, importance?, description?, assigneeId?, projectId?, requirementId?, sprintId?, estimate?, storyPoints?, labels?` | 创建 issue（缺陷传 type='bug'）；返回展示 key |
| `spms_update_issue` | `key, ...任意可更新字段` | 改状态/指派/优先级/标题/描述等 |
| `spms_add_comment` | `key, body` | 给 issue 加评论 |
| `spms_upload_issue_attachment` | `key, filename, data, contentType?` | 上传图片附件（data 为 base64；≤10MB，jpeg/png/gif/webp/avif）。配合 `spms_update_issue`（status='done'）实现"传图并关单" |
| `spms_create_requirement` | `projectId, title, type?, category?, priority?, importance?, description?, acceptanceCriteria?, releaseId?` | 创建需求（自动分配 FR/NFR key） |
| `spms_update_requirement` | `key, ...` | 更新需求 |
| `spms_create_test_case` | `projectId, title, requirementId?, priority?, preconditions?, steps?, expected?` | 创建测试用例 |
| `spms_update_test_case` | `key, ...` | 更新用例（含 result: passed/failed/blocked） |
| `spms_move_issue_to_sprint` | `sprintId（或 '_backlog'）, issueKey, storyPoints?` | 移入/移出迭代 |
| `spms_start_sprint` | `id` | 启动迭代（planned → active；同项目唯一进行中） |
| `spms_complete_sprint` | `id` | 完成迭代（active → completed；未完成 Issue 移回待办，返回 movedCount） |
| `spms_create_project` | `name, releaseId?, leadId?, target?, description?` | 创建项目 |

写工具与 REST API 复用同一套 `src/server/services/*`，业务规则一致（如 sprint-project 一致性校验、REQUIREMENT_NOT_FOUND 等错误码原样抛出）。

## 操作者身份

- **DB key 调用**：Actor = 令牌的**所属人**（`ownerId`，默认创建人，可在 /agent-access 随时修改），companyRole = 所属人在目标公司的真实 membership 角色（平台管理员无 membership 时按 `company_admin`）。activities 的 `whoId` 记为所属人的 member id，"我的 issue"即所属人名下 issue；写操作同时受所属人 RBAC 角色（权限矩阵）与 key 能力上限双重约束。所属人不是目标公司成员且非平台管理员 → `FORBIDDEN`；所属人用户被删除 → `UNAUTHORIZED`。
- **env 兜底 key**：Actor = 目标公司的内置 `scribe` agent member，companyRole=company_admin（开发兼容的遗留行为）。
- **浏览器 session 调用**（调试）：Actor = 会话用户本人及其当前公司，权限与其 RBAC 角色一致。
