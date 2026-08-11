# spms API 清单

业务前缀 `/api/v1/pms`；平台管理前缀 `/api/v1/platform`（仅平台管理员）。认证：cookie session（`POST /api/auth/login` 获取）。
响应信封：业务结果一律 HTTP 200 + `{ ok:true, data } | { ok:false, error:{ code, message } }`；详情不存在返回 `ok(null)`。

## 权限门（RBAC）

- 每个 service 入口按「路由 → 模块」映射做 `requirePerm(actor, module, read|write)`，不足 → **403 FORBIDDEN**（真实状态码）。
- 模块映射：`/issues*`→issues · `/requirements*`→requirements · `/projects*`→projects · `/sprints*`→sprints（`/sprints/backlog`→backlog）· `/product-lines|/products|/releases*`→products · `/resources|/assignments*`→resources · `/test-cases*`→testcases · `/reports*|/summary`→reports。
- `company_admin` 与平台管理员恒过；`viewer` 类只读角色调写接口同样 403。
- **项目创建/删除**额外要求 `company_admin` 或平台管理员（矩阵 projects=write 不够）。
- bootstrap 无模块门（登录即可），返回里的 `permissions` 供前端过滤 UI。
- **指派可见性**（读收窄，见 ARCHITECTURE「指派可见性」）：bootstrap 及 issues/requirements/test-cases/sprints/products/releases 的列表与详情按研发资源指派（direct）收窄——project/sprint 只看自身 direct（project 可见其下 sprint、sprint 上溯 project），祖先（product/release）direct 不下放；范围外详情按 `ok(null)` 处理。管理员（company_admin/平台）豁免；产品线不过滤；无项目 issue 视为公司级；MCP 再与令牌项目白名单取交集。

## 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | `{ username, password }` → 写 session cookie（payload 含 `cid` 当前公司）；`username` 也接受任一邮箱（user_emails 主/备） |
| POST | `/api/auth/logout` | 清 cookie |
| GET | `/api/auth/session` | 未登录 → `ok(null)`；已登录 → `{ user, companies, currentCompany, companyRole, isPlatformAdmin, permissions }`（user 含 `email` 主邮箱、`hasPassword`；companies=可进入的公司，平台管理员见全部；permissions=各模块有效级别） |
| POST | `/api/auth/switch-company` | `{ companyId }` → 重签 cookie 切换当前公司；要求目标公司成员或平台管理员 |
| POST | `/api/auth/change-password` | `{ oldPassword?, newPassword }`（新密码 ≥6 位）；旧密码错误 → 403；纯 OAuth 账号（无密码）免旧密码直接设置，设置后开通密码登录 |
| PATCH | `/api/auth/profile` | `{ name }` → 更新当前用户姓名，并同步各公司 member 行的 name/initials |
| GET | `/api/auth/emails` | 当前用户邮箱列表 `[{ email, isPrimary, verified }]`（主邮箱在前） |
| POST | `/api/auth/emails` | `{ email }` 添加备用邮箱（自填 verified=false；全表查重 → CONFLICT；备用 ≤5 个） |
| PATCH | `/api/auth/emails` | `{ email }` 把该邮箱设为主邮箱 |
| DELETE | `/api/auth/emails` | `{ email }` 删除备用邮箱（主邮箱不可删） |
| GET | `/api/auth/oauth/config` | `{ feishu: { configured, url? }, lark: {...}, github: {...} }`（各第三方登录是否已配置） |
| GET | `/api/auth/feishu/login` | 302 跳转飞书授权页（未配置 → 404） |
| GET | `/api/auth/feishu/callback` | 飞书 OAuth 回调：union_id 命中（`feishuUnionId`）→直接登录；否则 IdP 邮箱（个人+企业逐个）匹配已有账号（user_emails 主/备，其次用户名）→绑定身份；仍无匹配则建 users 账号；IdP 全部邮箱登记进 user_emails（verified）并按全部邮箱+手机号认领「邀请外部资源」（回填 userId、转 internal、每邀请公司补 viewer 席位；老用户每次登录重试）→ 跳 `/issues`；失败跳 `/login?error=feishu` |
| GET | `/api/auth/lark/login` | 302 跳转 Lark（国际版）授权页（未配置 → 404） |
| GET | `/api/auth/lark/callback` | Lark OAuth 回调，逻辑同飞书 callback；失败跳 `/login?error=lark` |
| GET | `/api/auth/github/login` | 302 跳转 GitHub 授权页（OAuth App，scope `read:user user:email`；未配置 → 404） |
| GET | `/api/auth/github/callback` | GitHub OAuth 回调，逻辑同飞书 callback（身份按数字 id 存 `users.githubId`，邮箱取自 `/user/emails` 的 verified 邮箱）；失败跳 `/login?error=github` |
| GET | `/api/auth/<provider>/bind` | 已登录用户发起绑定：写 nonce cookie 后 302 跳授权页（`state=bind.<nonce>`） |
| GET | `/api/auth/<provider>/callback` | 绑定模式（`state=bind.*`）：校验 nonce + session 后把身份挂到当前用户（飞书 → `feishuUnionId`，Lark → `larkUnionId`，GitHub → `githubId`）→ 302 `/profile/security?oauth=bound\|taken\|failed` |
| POST | `/api/auth/oauth/unbind` | `{ provider?: 'lark' \| 'github' }` 解绑当前账号的对应身份（缺省 lark）；无密码账号解绑最后一个身份时拒绝，防止锁死 |

## Meta

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/bootstrap` | 启动参考数据：`{ me, role, companyRole, companies, currentCompany, permissions, members, teams, labels, projects, myProjectIds, sprints, productLines, products, releases }`；均为**当前公司**沙箱内数据；projects/releases 的 progress 为派生值；`myProjectIds` 为「我参与的」项目集（本人 direct 指派的项目及其指派迭代关联的项目，口径同指派可见性），供项目列表「全部/我参与的」筛选 |

## Issues（缺陷 = type='bug'）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/issues?team&assignee&project&includeArchived&recentDone` | 列表，updatedAt desc；带 labels/subIssues/requirement.key；`sub:{done,total}`；默认排除已归档 issue 及已归档项目的 issue（`includeArchived=1` 放行，项目中心等历史上下文用）；`recentDone=1` 时已完成（done）只显示最近一周完成的记录（按 `completedAt`，全部/我的 Issues 视图 opt-in，其余消费方全量） |
| GET | `/issues/:key` | 详情（含 activities）；不存在 → `ok(null)` |
| POST | `/issues` | title 必填；requirementId 收展示 key；sprint-project 一致性（冲突 → LIFECYCLE_MISMATCH）；写 created activity；指派 agent 触发 AI 演示 |
| PATCH | `/issues/:key` | 部分更新；labels 全量替换；assignee 变更写 assign activity |
| POST | `/issues/:key/archive` | `{ archived: boolean }` 归档/取消归档（写 status activity；只影响可见性，不做只读约束） |
| DELETE | `/issues/:key` | 硬删（级联 labels/subIssues/activities） |
| POST | `/issues/:key/comments` | `{ body }`；commentsCount+1 |
| PATCH | `/issues/:key/sub/:subId` | `{ status }` 切换子任务 |

## Requirements

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/requirements?project&type` | position asc；附 `issues: string[]`（展示 keys）+ `issueStats:{total,done}`；排除归属已归档项目的需求 |
| GET | `/requirements/:key` | 不存在 → `ok(null)` |
| POST | `/requirements` | projectId/title 必填；key 按 type 分配 FR-N / NFR-N；functional 强制 category=null |
| PATCH | `/requirements/:key` | 部分更新；type 改 functional 清 category |
| DELETE | `/requirements/:key` | 硬删（引用 set null） |

## Projects

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/projects` | **需 company_admin 或平台管理员**；lead 双写（leadId→assignments lead，aiLeadId→member） |
| PATCH | `/projects/:id` | 部分更新 + lead 双写同步（projects=write） |
| POST | `/projects/:id/archive` | `{ archived: boolean }` 归档/取消归档（**需 company_admin 或平台管理员**）；归档项目的全部 issue 从「全部 Issues」/产品待办隐藏（等效批量归档），项目卡片默认隐藏 |
| DELETE | `/projects/:id` | **需 company_admin 或平台管理员**；先 clearSubtreeAssignments，issues set null，再删 |

列表走 `/bootstrap`，无独立 GET。

## Sprints

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/sprints?team` | 列表 |
| POST | `/sprints` | **新增**（原系统无）：name/startDate/endDate/projectIds（数组，可跨多项目）等 |
| PATCH | `/sprints/:id` | **新增**：部分更新（projectIds 整体替换） |
| DELETE | `/sprints/:id` | **新增**：issues.sprintId set null 后删 |
| GET | `/sprints/backlog?team` | 产品待办：sprintId IS NULL 且 status=todo（待处理）的 issues，backlogRank asc；其他状态及已归档（含已归档项目的）一律不进 |
| GET | `/sprints/velocity?team` | 每 sprint committed/completed/capacity + avgVelocity |
| GET | `/sprints/:id` | 元数据 + committed issues + stats |
| GET | `/sprints/:id/burndown` | ideal 线性 + snapshots actual |
| PATCH | `/sprints/:id/issues/:issueKey` | 移入/移出（`:id` 可为 `_backlog`）；迭代有项目时 issue 的项目必须在其中（否则 LIFECYCLE_MISMATCH），issue 无项目且迭代恰好一个项目时自动归属 |
| POST | `/sprints/:id/start` | planned → active；迭代任一项目已有进行中迭代 → CONFLICT（PATCH 直改 status=active 同样校验） |
| POST | `/sprints/:id/complete` | active → completed；未完成（非 done/canceled）issues sprintId set null 移回待办，返回 `{ sprint, movedCount }` |

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
| POST | `/resources/invite` | `{ name?, email?, phone?, userId? }`，email/phone/userId 至少其一；重复 → INVITE_FAILED；origin=external, status=invited；phone 归一化纯数字存储，与 email 并列作认领匹配键 |
| POST | `/resources/:id/revoke` | 仅 external；unassignMemberEverywhere + status=revoked |
| GET | `/seats` | 当前公司席位列表（memberships ⋈ users，研发资源"内部成员"段数据源） |
| PATCH | `/seats/:id` | `{ role }` 改席位的公司角色（company_admin 或平台管理员） |
| DELETE | `/seats/:id` | 回收席位（company_admin 或平台管理员；账号与其他席位保留；同步撤销资源池投影） |
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
| GET | `/test-cases?project&requirement&status&result` | requirement 收展示 key；排除归属已归档项目的用例 |
| GET | `/test-cases/:key` | 不存在 → `ok(null)` |
| POST | `/test-cases` | 项目必须存在；分配 TC-N；authorId=当前成员 |
| PATCH | `/test-cases/:key` | 部分更新 |
| DELETE | `/test-cases/:key` | 硬删 |

## Daily Reports 日报（`/reports*`，模块门 reports；read=查看(行级可见),write=提交/编辑自己的）

行级可见性：company_admin/平台管理员全公司可见；其他成员可见本人日报的全部条目，以及他人日报中属于自己负责产品（`products.leadId` = 我）的条目——过滤后无可见条目的他人日报不出现在结果中；无席位（memberId 为 null）的非管理员看不到任何日报。汇总、复制汇总在前端消费列表数据，同一规则自然生效。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/reports?startDate&endDate&memberId&productId` | 日报列表（含按产品拆分的 entries），日期闭区间，上限 500 条 |
| GET | `/reports/mine?date=YYYY-MM-DD` | 我某天的日报；无则 `ok(null)` |
| PUT | `/reports/mine` | `{ date, entries: [{ productId, content }] }` 覆盖提交：同日已有则全量替换 entries（同日唯一约束兜底）；entries 至少一条非空；产品须属本公司且未归档 |
| DELETE | `/reports/:id` | 删除；仅本人或 company_admin/平台管理员 |
| GET | `/reports/stats?today=YYYY-MM-DD` | `{ totalReports, todayCount, memberCount, trend[7], unsubmitted[] }`；today 由客户端按本地时区给出（缺省回退服务器 UTC 日）；未提交名单只计 internal+active 的 human 成员，且仅对管理员返回（非管理员恒为空数组）；totalReports/todayCount/trend 对非管理员按行级可见性口径统计 |

日期一律为 'YYYY-MM-DD' 日历日字符串（date 列），服务端不做时区换算。

## Team Summary 团队总结（`/summary`，模块门复用 reports；read）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/summary?period=daily\|weekly&date=YYYY-MM-DD&tzMin&memberId&projectId` | 周期统计（TKT-33）：`period=weekly` 时 date 归一到所在自然周（周一至周日）；`tzMin` = 本地 − UTC 的分钟数（如 CST 480），用于把日历日换算成 UTC 边界；memberId/projectId 可选过滤 |

口径：新建 = 实体 `createdAt` 落入周期；交付 = `issue_status_transitions` to `testing`；验收完成 = 流转 to `done` ∪ `completedAt` 兜底（Notion 同步只回写 completedAt），按 issue 去重；验收打回 = 从 `testing` 回 todo/in_progress/backlog；重开 = 从 `done` 离开。成员过滤对流量指标按行为人（流转/创建活动/作者 whoId），对存量指标（在办/待验收/积压/状态分布）按当前负责人。返回卡片（本期+上期值）、吞吐分桶（每日=14 天；每周=周 7 天 + 12 周趋势）、周期时长三段（建单→首次可测试 / 首次可测试→首次验收 / 端到端，avg/P90/max+maxKey）、验收积压、当前流动健康、按成员分列（全部 active 成员）。

## Integrations 集成（Notion，均需 issues=write）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/integrations/notion/authorize` | 发起 OAuth：写 nonce cookie（CSRF）→ 302 Notion 授权页；env 未配置 → 404 |
| GET | `/integrations/notion/callback` | 校验 nonce、Basic auth 换 token、按公司 upsert `notion_connections`（token 仅服务端保存，从不下发）→ 302 `/integrations?notion=connected\|failed` |
| GET | `/integrations/notion` | 连接状态（不含 token）；`?databases=1` 附 Notion search 拉到的数据库列表（失败降级为 `databases:null` + `databasesError`）；`?statuses=1` 返回状态映射/过滤规则（数据库状态选项 ∪ 已存 `statusMap`，未配置的按默认映射猜测、默认同步） |
| PATCH | `/integrations/notion` | `{ databaseId?, databaseName?, projectId?, statusMap? }` 保存同步数据库/目标项目（projectId 校验属于本公司）；`statusMap` 为每个 Notion 状态的 `{ name, status, sync }` 规则（status=null 不映射、sync=false 不同步；置 null 恢复内置默认） |
| DELETE | `/integrations/notion` | 断开：删连接行，issue 映射随 cascade 删除（重连后全量重同步） |
| GET | `/integrations/notion/preview` | 拉所选数据库最近编辑的一条记录，返回原始 Notion page JSON（字段映射调试用） |
| POST | `/integrations/notion/sync` | 手动同步 Notion → Issues（按 `lastSyncedAt` 水位增量，幂等靠 `notion_issue_links`），返回 `{ created, updated, skipped, errors }`；`?full=1` 全量重同步：忽略水位重拉全部页面（幂等不变，未变更页跳过），用于 issue 被直接删除后的重建 |

## Platform 平台管理（`/api/v1/platform`，仅平台管理员，否则 403；`/mcp-keys` 除外，见下）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/companies` | 全部公司 + 成员数 |
| POST | `/companies` | `{ key, name, color?, description? }` 创建公司；创建者自动成为其 company_admin |
| PATCH | `/companies/:id` | 改展示字段（name/color/description；key 不可改） |
| POST | `/companies/:id/enter` | 重签 cookie 进入该公司（同 switch-company；成员或平台管理员） |
| GET | `/companies/:id/members` | 公司成员列表（membership + user 信息） |
| POST | `/companies/:id/members` | `{ username, role, name?, password?, email? }` 加成员（=分配席位）；用户名不存在时现场建账号（需 password）；email 写入主邮箱（user_emails）；分配时同步投影进资源池 |
| PATCH | `/companies/:id/members/:membershipId` | `{ role }` 改公司内角色 |
| DELETE | `/companies/:id/members/:membershipId` | 移出成员（=回收席位；user 账号保留；同步撤销资源池投影） |
| GET | `/users` | 平台成员目录：全部系统用户 + 各自公司席位（含主邮箱 `email`） |
| POST | `/users` | `{ username, name?, password, email? }` 新建系统账号（role=member，不含席位）；email 写入主邮箱（user_emails） |
| DELETE | `/users/:userId` | 删除系统账号（不能删自己）：先 revoke 其在各家公司的 member 投影（移出指派、置 revoked，行保留姓名快照），再删 users 行（`members.user_id` FK set null 兜底；company_memberships/user_emails 随 cascade） |
| GET | `/permissions-matrix` | 全量 4 角色 × 11 模块矩阵 |
| PUT | `/permissions-matrix` | `{ matrix }` 整表替换（逐格校验后 upsert + 缓存失效） |
| GET | `/mcp-keys` | MCP key 列表（不返回 keyHash/明文；含 ownerId/ownerName）；管理员见全部，member 只见自己创建的 |
| POST | `/mcp-keys` | `{ name, companyId?, ownerId?, capabilities?, expiresInDays? }` 签发 key（管理员：companyId 省略=平台级；member 自助：companyId 省略=当前公司，且必须是其所属公司，显式 null/他人公司 → 403；ownerId=所属人，省略=创建人，公司级 key 的所属人必须是该公司成员或平台管理员；capabilities ⊆ read/write/delete，默认 `['read','write']`；expiresInDays 省略=永不过期）；**明文仅本次返回** |
| PATCH | `/mcp-keys/:id` | `{ ownerId }` 修改所属人（MCP 调用的第一人称身份）；member 只能改自己的 key，否则 403 |
| DELETE | `/mcp-keys/:id` | 吊销（写 revokedAt，行保留审计）；带 `?permanent=1` 时硬删除该 key 行；member 只能操作自己的 key，否则 403 |

## 错误码（主要）

`UNAUTHORIZED` `FORBIDDEN` `NO_COMPANY`（用户无公司归属）`VALIDATION_FAILED` `NOT_FOUND` `REQUIREMENT_NOT_FOUND` `LIFECYCLE_MISMATCH` `INVITE_FAILED` `RESOURCE_REVOKED`
