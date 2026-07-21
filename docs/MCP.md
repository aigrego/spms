# next-spms MCP 服务

HTTP Streamable MCP 端点，供 Agent 连接并读取/处理需求、任务、缺陷等。
实现：`@modelcontextprotocol/sdk` 的 `StreamableHTTPServerTransport`，挂在 Next.js `/mcp` 路由（处理 POST/GET/DELETE）。

## 接入

- **URL**：`http://localhost:3000/mcp`
- **鉴权**：请求头 `Authorization: Bearer <key>`，key 来自 env `MCP_API_KEY`（支持逗号分隔多个）；开发默认 `dev-mcp-key`。浏览器登录 session 也可访问（便于调试）。

客户端配置示例（Claude Code / 其他 MCP host）：

```json
{
  "mcpServers": {
    "next-spms": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer dev-mcp-key" }
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

## Tools

### 读

| Tool | 参数 | 说明 |
|---|---|---|
| `spms_get_bootstrap` | — | 全量参考数据（members/labels/projects/sprints/产品线/产品/版本） |
| `spms_list_issues` | `status? type? priority? assignee? project? sprint?` | Issue 列表（筛选均可选；type=bug 即缺陷列表） |
| `spms_get_issue` | `key` | Issue 详情（含 labels/subIssues/activities 评论流） |
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
| `spms_create_requirement` | `projectId, title, type?, category?, priority?, importance?, description?, acceptanceCriteria?, releaseId?` | 创建需求（自动分配 FR/NFR key） |
| `spms_update_requirement` | `key, ...` | 更新需求 |
| `spms_create_test_case` | `projectId, title, requirementId?, priority?, preconditions?, steps?, expected?` | 创建测试用例 |
| `spms_update_test_case` | `key, ...` | 更新用例（含 result: passed/failed/blocked） |
| `spms_move_issue_to_sprint` | `sprintId（或 '_backlog'）, issueKey, storyPoints?` | 移入/移出迭代 |
| `spms_create_project` | `name, releaseId?, leadId?, target?, description?` | 创建项目 |

写工具与 REST API 复用同一套 `src/server/services/*`，业务规则一致（如 sprint-project 一致性校验、REQUIREMENT_NOT_FOUND 等错误码原样抛出）。

## 操作者身份

MCP 调用以系统操作者身份执行：activities 的 `whoId` 记为 `scribe` agent member，评论/变更在历史流中可追溯来源是 Agent 操作。
