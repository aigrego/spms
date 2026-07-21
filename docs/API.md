# next-spms API 清单

业务前缀 `/api/v1/pms`；平台管理前缀 `/api/v1/platform`（仅平台管理员）。认证：cookie session（`POST /api/auth/login` 获取）。
响应信封：业务结果一律 HTTP 200 + `{ ok:true, data } | { ok:false, error:{ code, message } }`；详情不存在返回 `ok(null)`。

## 权限门（RBAC）

- 每个 service 入口按「路由 → 模块」映射做 `requirePerm(actor, module, read|write)`，不足 → **403 FORBIDDEN**（真实状态码）。
- 模块映射：`/issues*`→issues · `/requirements*`→requirements · `/projects*`→projects · `/sprints*`→sprints（`/sprints/backlog`→backlog）· `/product-lines|/products|/releases*`→products · `/resources|/assignments*`→resources · `/test-cases*`→testcases。
- `company_admin` 与平台管理员恒过；`viewer` 类只读角色调写接口同样 403。
- **项目创建/删除**额外要求 `company_admin` 或平台管理员（矩阵 projects=write 不够）。
- bootstrap 无模块门（登录即可），返回里的 `permissions` 供前端过滤 UI。

## 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | `{ username, password }` → 写 session cookie（payload 含 `cid` 当前公司） |
| POST | `/api/auth/logout` | 清 cookie |
| GET | `/api/auth/session` | 未登录 → `ok(null)`；已登录 → `{ user, companies, currentCompany, companyRole, isPlatformAdmin, permissions }`（companies=可进入的公司，平台管理员见全部；permissions=各模块有效级别） |
| POST | `/api/auth/switch-company` | `{ companyId }` → 重签 cookie 切换当前公司；要求目标公司成员或平台管理员 |
| POST | `/api/auth/change-password` | `{ oldPassword, newPassword }`（新密码 ≥6 位）；旧密码错误 → 403；飞书扫码账号无密码不可改 |
| PATCH | `/api/auth/profile` | `{ name }` → 更新当前用户姓名，并同步各公司 member 行的 name/initials |
| GET | `/api/auth/lark/config` | `{ enabled: boolean }`（飞书是否已配置） |
| GET | `/api/auth/lark` | 302 跳转飞书授权页 |
| GET | `/api/auth/lark/callback` | 飞书 OAuth 回调，写 session 后跳 `/issues` |

## Meta

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/bootstrap` | 启动参考数据：`{ me, role, companyRole, companies, currentCompany, permissions, members, teams, labels, projects, sprints, productLines, products, releases }`；均为**当前公司**沙箱内数据；projects/releases 的 progress 为派生值 |

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
| POST | `/projects` | **需 company_admin 或平台管理员**；lead 双写（leadId→assignments lead，aiLeadId→member） |
| PATCH | `/projects/:id` | 部分更新 + lead 双写同步（projects=write） |
| DELETE | `/projects/:id` | **需 company_admin 或平台管理员**；先 clearSubtreeAssignments，issues set null，再删 |

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
| GET | `/seats` | 当前公司席位列表（memberships ⋈ users，研发资源"内部成员"段数据源） |
| PATCH | `/seats/:id` | `{ role }` 改席位的公司角色（company_admin 或平台管理员） |
| DELETE | `/seats/:id` | 回收席位（company_admin 或平台管理员；账号与其他席位保留） |
| GET | `/permissions-matrix` | 本公司有效矩阵（全局默认 + 本公司覆盖；company_admin 或平台管理员） |
| PUT | `/permissions-matrix` | `{ matrix }` 整表替换本公司覆盖矩阵（同上） |

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

## Platform 平台管理（`/api/v1/platform`，仅平台管理员，否则 403；`/mcp-keys` 除外，见下）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/companies` | 全部公司 + 成员数 |
| POST | `/companies` | `{ key, name, color?, description? }` 创建公司；创建者自动成为其 company_admin |
| PATCH | `/companies/:id` | 改展示字段（name/color/description；key 不可改） |
| POST | `/companies/:id/enter` | 重签 cookie 进入该公司（同 switch-company；成员或平台管理员） |
| GET | `/companies/:id/members` | 公司成员列表（membership + user 信息） |
| POST | `/companies/:id/members` | `{ username, role, name?, password? }` 加成员（=分配席位）；用户名不存在时现场建账号（需 password）；分配时同步投影进资源池 |
| PATCH | `/companies/:id/members/:membershipId` | `{ role }` 改公司内角色 |
| DELETE | `/companies/:id/members/:membershipId` | 移出成员（=回收席位；user 账号保留） |
| GET | `/users` | 平台成员目录：全部系统用户 + 各自公司席位 |
| POST | `/users` | `{ username, name?, password }` 新建系统账号（role=member，不含席位） |
| GET | `/permissions-matrix` | 全量 4 角色 × 10 模块矩阵 |
| PUT | `/permissions-matrix` | `{ matrix }` 整表替换（逐格校验后 upsert + 缓存失效） |
| GET | `/mcp-keys` | MCP key 列表（不返回 keyHash/明文）；管理员见全部，member 只见自己创建的 |
| POST | `/mcp-keys` | `{ name, companyId?, capabilities?, expiresInDays? }` 签发 key（管理员：companyId 省略=平台级；member 自助：companyId 省略=当前公司，且必须是其所属公司，显式 null/他人公司 → 403；capabilities ⊆ read/write/delete，默认 `['read','write']`；expiresInDays 省略=永不过期）；**明文仅本次返回** |
| DELETE | `/mcp-keys/:id` | 吊销（写 revokedAt，行保留审计）；带 `?permanent=1` 时硬删除该 key 行；member 只能操作自己的 key，否则 403 |

## 错误码（主要）

`UNAUTHORIZED` `FORBIDDEN` `NO_COMPANY`（用户无公司归属）`VALIDATION_FAILED` `NOT_FOUND` `REQUIREMENT_NOT_FOUND` `LIFECYCLE_MISMATCH` `INVITE_FAILED` `RESOURCE_REVOKED`
