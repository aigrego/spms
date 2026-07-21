# next-spms API 清单

统一前缀 `/api/v1/pms`。认证：cookie session（`POST /api/auth/login` 获取）。
响应信封：业务结果一律 HTTP 200 + `{ ok:true, data } | { ok:false, error:{ code, message } }`；详情不存在返回 `ok(null)`。

## 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | `{ username, password }` → 写 session cookie |
| POST | `/api/auth/logout` | 清 cookie |
| GET | `/api/auth/session` | `{ user: { id, username, name, role } \| null }` |
| GET | `/api/auth/lark/config` | `{ enabled: boolean }`（飞书是否已配置） |
| GET | `/api/auth/lark` | 302 跳转飞书授权页 |
| GET | `/api/auth/lark/callback` | 飞书 OAuth 回调，写 session 后跳 `/issues` |

## Meta

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/bootstrap` | 启动参考数据：`{ me, role, members, teams, labels, projects, sprints, productLines, products, releases }`；projects/releases 的 progress 为派生值 |

## Issues（缺陷 = type='bug'）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/issues?team&assignee&project` | 列表，updatedAt desc；带 labels/subIssues/requirement.key；`sub:{done,total}` |
| GET | `/issues/:key` | 详情（含 activities）；不存在 → `ok(null)` |
| POST | `/issues` | title 必填；requirementId 收展示 key；sprint-project 一致性（冲突 → LIFECYCLE_MISMATCH）；写 created activity；指派 agent 触发 AI 演示 |
| PATCH | `/issues/:key` | 部分更新；labels 全量替换；assignee 变更写 assign activity |
| DELETE | `/issues/:key` | 硬删（级联 labels/subIssues/activities） |
| POST | `/issues/:key/comments` | `{ body }`；commentsCount+1 |
| PATCH | `/issues/:key/sub/:subId` | `{ status }` 切换子任务 |

## Requirements

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/requirements?project&type` | position asc；附 `issues: string[]`（展示 keys）+ `issueStats:{total,done}` |
| GET | `/requirements/:key` | 不存在 → `ok(null)` |
| POST | `/requirements` | projectId/title 必填；key 按 type 分配 FR-N / NFR-N；functional 强制 category=null |
| PATCH | `/requirements/:key` | 部分更新；type 改 functional 清 category |
| DELETE | `/requirements/:key` | 硬删（引用 set null） |

## Projects

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/projects` | **需 admin**；lead 双写（leadId→assignments lead，aiLeadId→member） |
| PATCH | `/projects/:id` | 部分更新 + lead 双写同步 |
| DELETE | `/projects/:id` | **需 admin**；先 clearSubtreeAssignments，issues set null，再删 |

列表走 `/bootstrap`，无独立 GET。

## Sprints

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/sprints?team` | 列表 |
| POST | `/sprints` | **新增**（原系统无）：name/startDate/endDate/projectId 等 |
| PATCH | `/sprints/:id` | **新增**：部分更新 |
| DELETE | `/sprints/:id` | **新增**：issues.sprintId set null 后删 |
| GET | `/sprints/backlog?team` | sprintId IS NULL 的 issues，backlogRank asc |
| GET | `/sprints/velocity?team` | 每 sprint committed/completed/capacity + avgVelocity |
| GET | `/sprints/:id` | 元数据 + committed issues + stats |
| GET | `/sprints/:id/burndown` | ideal 线性 + snapshots actual |
| PATCH | `/sprints/:id/issues/:issueKey` | 移入/移出（`:id` 可为 `_backlog`）；移入强制 projectId=sprint.projectId |

## Catalog 生命周期目录

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/product-lines` | POST 自动分配 PL-N |
| PATCH/DELETE | `/product-lines/:id` | DELETE 先清子树 assignments，级联删 |
| GET/POST | `/products?line` | POST 分配 PD-N；leadId 双写 |
| PATCH/DELETE | `/products/:id` | 同上 |
| GET/POST | `/releases?product` | POST 分配 RL-N；targetDate 收 ISO 字符串 |
| PATCH/DELETE | `/releases/:id` | 同上 |

## Resources 资源池

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/resources` | 全部 members（type,name 排序），含 origin/email/status |
| POST | `/resources/invite` | `{ name?, email?, userId? }`，email/userId 至少其一；重复 → INVITE_FAILED；origin=external, status=invited |
| POST | `/resources/:id/revoke` | 仅 external；unassignMemberEverywhere + status=revoked |

（原系统的 `sync-directory` 依赖 portal，已移除）

## Assignments 虚拟团队

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/assignments?nodeType&nodeId` | 节点指派列表（join member，lead 在前） |
| GET | `/assignments/candidates?nodeType&nodeId` | 候选池 + assignedHere/inParentPool 标记 |
| GET | `/assignments/issue-candidates?issueKey` | issue 负责人候选（sprint 池→project 池→全池；agent 永远候选） |
| GET | `/assignments/impact?nodeType&nodeId` | 删除影响预览（descendants + assignments 计数） |
| POST | `/assignments` | `{ nodeType, nodeId, memberId, role? }`；revoked → RESOURCE_REVOKED；沿祖先链传播 |
| PATCH | `/assignments/:id` | 改 role（lead/member） |
| DELETE | `/assignments?nodeType&nodeId&memberId` | propagated 行不可删（提示去来源子节点移除）；向下级联删 + 祖先 GC |

## Test Cases

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/test-cases?project&requirement&status&result` | requirement 收展示 key |
| GET | `/test-cases/:key` | 不存在 → `ok(null)` |
| POST | `/test-cases` | 项目必须存在；分配 TC-N；authorId=当前成员 |
| PATCH | `/test-cases/:key` | 部分更新 |
| DELETE | `/test-cases/:key` | 硬删 |

## 错误码（主要）

`UNAUTHORIZED` `FORBIDDEN` `VALIDATION_FAILED` `NOT_FOUND` `REQUIREMENT_NOT_FOUND` `LIFECYCLE_MISMATCH` `INVITE_FAILED` `RESOURCE_REVOKED`
