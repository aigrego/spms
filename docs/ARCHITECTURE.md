# next-spms 架构设计

## 总体架构

```
┌─────────────────────────────────────────────────────────┐
│                     Next.js 16 应用                      │
│                                                         │
│  浏览器 UI (App Router)      Agent (MCP client)         │
│      │                          │                       │
│      ▼                          ▼                       │
│  /api/v1/pms/**  /api/v1/platform/**   /mcp (Streamable)│
│      │                          │                       │
│      ▼                          ▼                       │
│  Actor 解析（session cid / MCP key → 公司 + 角色）       │
│      │                          │                       │
│      ▼                          ▼                       │
│  RBAC 权限门（requirePerm：角色×模块矩阵）              │
│      │                          │                       │
│      └──────┬───────────────────┘                       │
│             ▼                                           │
│   src/server/services/*  （业务逻辑唯一出处）            │
│             ▼                                           │
│   src/lib/* (session/permissions/rollup/keys/...)       │
│             ▼                                           │
│        drizzle-orm ──► PostgreSQL                       │
└─────────────────────────────────────────────────────────┘
```

关键原则：**业务逻辑只写在 services 层**，API 路由和 MCP tools 都是薄适配层，避免逻辑分叉。

## 多公司沙箱

- **公司是数据隔离边界**：全部业务表带 `companyId`，所有 services 查询强制按当前公司过滤；编号（BUG-N/FR-N…）按公司独立。
- **当前公司由 session `cid` 决定**（MCP 由 key 决定，见下）：登录/切换公司时重签 cookie。
- **Actor**：services 层统一入参 `{ userId, memberId, name, role, companyId, companyRole, isPlatformAdmin }`，由 `src/server/http.ts` 的 `requireActor()` 从 session 解析（无公司归属 → `NO_COMPANY`）。

## 目录结构

```
next-spms/
├── drizzle/                    # 迁移文件
├── docs/                       # 项目文档（本目录）
├── scripts/seed.ts             # 初始数据（admin/agent/演示数据）
├── src/
│   ├── db/
│   │   ├── schema.ts           # 22 张表 + 21 个枚举 + relations
│   │   └── index.ts            # postgres-js 连接（DATABASE_URL）
│   ├── lib/                    # 服务端基础库
│   │   ├── env.ts              # 环境变量集中读取
│   │   ├── session.ts          # jose HS256 cookie session（7 天，payload 含 cid）
│   │   ├── password.ts         # bcryptjs 哈希
│   │   ├── envelope.ts         # { ok, data|error } 信封 + 错误码
│   │   ├── permissions.ts      # RBAC：角色×模块矩阵读取/缓存/权限门
│   │   ├── keys.ts             # counters 表原子递增编号（按公司）
│   │   ├── serialize.ts        # id→展示 key 序列化
│   │   ├── rollup.ts           # 项目/版本进度派生
│   │   ├── assignments.ts      # 指派传播代数（direct/propagated）
│   │   ├── identity.ts         # user↔member 懒绑定 + agent 兜底播种
│   │   └── agents.ts           # AI 演示剧本（同步写 activities）
│   ├── server/services/        # 业务服务层（API 与 MCP 共用）
│   │   ├── issues.ts  requirements.ts  projects.ts  sprints.ts
│   │   ├── catalog.ts resources.ts assignments.ts testcases.ts
│   │   ├── platform.ts           # 平台管理（公司/成员/矩阵/MCP key）
│   │   └── meta.ts             # bootstrap 聚合
│   ├── mcp/server.ts           # McpServer + tools 注册
│   ├── app/
│   │   ├── (auth)/login/       # 登录页（密码 + 飞书扫码）
│   │   ├── (app)/              # 主应用（Header + Sidebar 布局 + AuthGate）
│   │   │   ├── issues/  products/  requirements/  testcases/
│   │   │   ├── projects/  projects/[id]/  resources/
│   │   │   ├── roadmap/  backlog/  sprints/  sprints/[id]/
│   │   │   ├── settings/         # 设置页（偏好 + 平台管理 Tab，平台管理仅平台管理员；旧 /platform 重定向至此）
│   │   │   ├── agent-access/     # Agent 接入页（MCP 令牌自助管理，所有登录用户；member 仅自己的公司级 key）
│   │   │   ├── profile/          # 个人资料页（资料/安全/已授权应用三 Tab）
│   │   ├── api/v1/pms/**/route.ts   # 业务 API（路径与原系统一致）
│   │   ├── api/v1/platform/**/route.ts # 平台管理 API（仅平台管理员；mcp-keys 支持 member 自助）
│   │   ├── api/auth/           # login/logout/session/switch-company/change-password/lark/*
│   │   └── mcp/route.ts        # MCP Streamable HTTP 端点
│   ├── components/             # ui/ glyphs/ menus/ inline/ Header/ Sidebar/ profile/(改密码表单)/ platform/(设置页四个管理面板)/ 各详情抽屉
│   ├── views/ 或 components/   # 各页面视图（IssuesView/ProjectHub/...）
│   ├── store/                  # React Query hooks + AppDataProvider
│   └── lib/ (前端)             # types / api client / i18n
└── .env.local                  # DATABASE_URL / SESSION_SECRET / MCP_API_KEY / LARK_*
```

## 响应信封与错误约定

- 业务结果一律 HTTP 200 + `{ ok:true, data }` 或 `{ ok:false, error:{ code, message } }`
- 真实状态码仅用于 401（未登录）/ 403（权限不足）/ 404（路由不存在）/ 500
- 详情查询（issue/requirement/testcase/sprint）不存在时返回 `ok(null)`，不是 404
- 内部 uuid 不出网：issue/requirement/testCase 的 `id` 字段序列化为展示 key（如 `BUG-3`）

## 认证设计

### 密码登录
`POST /api/auth/login { username, password }` → bcrypt 校验 → jose HS256 签名 cookie
`spms_session`（HttpOnly / SameSite=Lax / 7 天），payload `{ uid, username, role, cid }`。
`username` 也接受**任一邮箱**（`user_emails` 主/备，大小写不敏感）——邮箱反查用户后共用同一密码。
`cid` = 当前公司 id，登录时取第一个可见公司；`POST /api/auth/switch-company { companyId }` 重签 cookie 切换（要求目标公司成员或平台管理员）。
纯 OAuth 账号（`passwordHash='!oauth'`）可在 /profile 安全页**免旧密码直接设置密码**，设置后密码登录开通——密码与飞书/Lark 登录由此统一到同一账号。

### 用户邮箱（user_emails）
一个用户可拥有多个邮箱：一个主邮箱（部分唯一索引保证）+ 至多 5 个备用；邮箱全表唯一（一个邮箱只属于一个用户）。无 SMTP，唯一验证来源是 Lark/飞书 OAuth 返回的邮箱（`verified`）——**只有 verified 邮箱可认领外部邀请/授予席位**；自填邮箱仅作登录标识、展示与 Notion 指派人匹配。管理端点 `GET/POST/PATCH/DELETE /api/auth/emails`（本人自助）；平台管理员建号/加成员时可写主邮箱；规则集中在 `src/lib/emails.ts`。

### 飞书扫码登录
1. 登录页按钮跳转 `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=...&redirect_uri=...`（飞书页面展示扫码）
2. 回调 `/api/auth/lark/callback?code=...`：
   - `app_access_token`（tenant 凭证）→ 用 code 换 `user_access_token` → 拉 `user_info`
   - 按 `larkUnionId` 找 user；不存在则自动创建 user（同名 member 懒绑定）
   - IdP 邮箱经 `upsertVerifiedEmail` 登记进 `user_emails`（verified，首个邮箱自动成为主邮箱），并按该邮箱认领「邀请外部资源」预埋的 members 行
   - 写 session cookie，跳 `/issues`
3. env 未配置 `LARK_APP_ID/LARK_APP_SECRET` 时，登录页隐藏飞书入口（前端通过 `/api/auth/lark/config` 探测）

### 权限模型（RBAC，二期）

**两层角色**：
- 平台级：`users.role` —— `admin`（平台管理员，恒全权限，可见 /settings 平台管理 Tab）| `member`（普通用户）
- 公司级：`company_memberships.role` —— `company_admin`（公司管理员，恒全权限）+ 4 个可配置角色
  `product_manager`（产品）/ `developer`（开发）/ `tester`（测试）/ `viewer`（只读）

**席位与成员目录**（三期）：
- **席位 = `company_memberships` 行**：决定用户能否进入某公司沙箱及公司角色。
- 平台管理员在 设置 → 成员管理 看**全部系统用户**（目录 + 新建用户）；在 公司管理 的公司卡片 → **席位**抽屉里把用户分配进/回收出某公司（默认角色 viewer）。
- 公司管理员在 **研发资源 → 内部成员** 给本公司席位成员调整公司角色 / 移除席位（`/api/v1/pms/seats`）。
- 席位分配时把用户幂等投影进本公司资源池（`members` 表，供指派）；席位移除时同步撤销该投影（移出所有节点指派、状态置 revoked，重新分配席位时自动重激活）。仅持席位的用户才会被懒投影——无席位的平台管理员进入公司沙箱不再产生 `members` 行（其 `Actor.memberId` 为 null）。
- **删除用户**（成员管理页，`DELETE /api/v1/platform/users/:userId`，不能删自己）：先把该用户在各家公司的投影逐一 revoke（同席位移除的善后），再删 `users` 行；`members.user_id` 外键 `ON DELETE SET NULL` 兜底——member 行永不随用户硬删，历史 issue/活动的归属与姓名快照保留。
- **邀请外部资源（按邮箱）**：邮箱已属于平台用户（`user_emails` 主/备）→ 直接落 `userId`、转 internal/active 并授 viewer 席位（与 Lark 认领同结果）；否则预埋 external/invited 行，等本人 Lark 登录按 verified 邮箱认领。

**角色×模块矩阵**（`src/lib/permissions.ts`）：
- 4 个可配置角色 × 10 个模块（issues/products/requirements/testcases/projects/resources/roadmap/backlog/sprints/agents）× 3 档（`none < read < write`）
- 矩阵存 `role_permissions` 表，**两层拆分**：`companyId=''` 为全局默认（平台管理员在 /settings?tab=matrix 配置），`companyId=<公司>` 为本公司覆盖（company_admin 在 /settings?tab=company-matrix 配置，`/api/v1/pms/permissions-matrix`）；生效值 = 全局 + 按单元格覆盖
- `company_admin` 与平台管理员恒全权限，不入矩阵；缺失行按 `none` 处理；进程内按公司缓存 60s
- **项目创建/删除**额外限定 `company_admin` 或平台管理员（不受矩阵 projects=write 影响）

**权限门**：services 每个入口 `requirePerm(actor, module, 'read'|'write')`，不足抛 `FORBIDDEN`（403）。
前端经 `GET /api/auth/session`（或 bootstrap）拿到 `permissions`（当前用户各模块有效级别），按此过滤侧边栏与按钮。

**指派可见性**（`src/lib/visibility.ts`，四期）：模块读权限之上再按「研发资源指派」收窄——project/sprint 对成员可见 ⟺ 该成员在其上有 `resource_assignments` **direct** 行，仅保留两个有限例外：加入 sprint → 其 project 可见（便于导航）；加入 project → 其下全部 sprint 可见。**祖先（product/release）direct 不下放**——产品/版本级成员不会自动看到其下项目的 issue，项目需单独指派；release/product 之间保持下放（product direct → 其 release 可见，作导航壳与需求管理层）。平台管理员/company_admin 豁免；无任何 direct 指派的普通成员看不到任何节点（严格模式）。应用点：bootstrap 与 issues/requirements/testcases/sprints/catalog 的 list + 详情（范围外按「不存在」处理），MCP 与令牌白名单 `allowedProjectIds` 取交集。产品线不过滤（导航壳，不在指派节点内）；`projectId` 为 NULL 的 issue 视为公司级不过滤；成员池/assignments 服务本身不过滤（管理入口需见全池）。只挡「看」，写操作权限不变。

默认矩阵（seed 写入全局层，可在 /settings?tab=matrix 改）：

| 角色 | write 模块 | read 模块 | none |
|---|---|---|---|
| product_manager | issues/products/requirements/projects/resources/roadmap/backlog | testcases/sprints/agents | — |
| developer | issues/backlog/sprints | 其余全部 | — |
| tester | issues/testcases | 其余大部分 | agents |
| viewer | — | 全部 | — |

## 指派传播代数（核心复用逻辑）

生命周期树：**product_line → product → release → project → sprint**（product_line 不是指派节点）。唯一的多父节点例外：sprint 可跨多个 project（`sprint_projects` 多对多），祖先遍历沿全部项目父链扇出（BFS 去重）。

不变式：成员在节点 N ⟺ 在 N 或 N 的某后代有 direct 指派 ⟹ 出现在 N 的所有祖先上（propagated）。

- `assignMember(N, member, role)`：N 上 upsert direct → 祖先链补 propagated（不动已有 direct）
- `unassignMember(N, member)`：删 N + 全部后代的行 → 由近及远 GC 祖先 propagated（后代无 direct 才删）
- 删节点前必须先 `clearSubtreeAssignments`（要读还在的子节点）
- lead 双写：product/project 的 `leadId`/`aiLeadId` 列与 assignments 表同步

## 进度派生（rollup）

- `progressOf(issues)`：有 storyPoints 按点数加权，否则按计数；只认 `done`（不含 canceled）
- bootstrap 时 `computeRollups()` 覆盖 projects/releases 的存储 progress 列（存储列仅作展示兜底）
- Sprint velocity：completed 状态 sprint 的完成点数均值；burndown：ideal 线性 + sprint_snapshots actual

## AI Agent 演示

4 个内置 agent member：atlas（规划）/ forge（开发）/ sentry（测试）/ scribe（文档）。
issue 指派给 agent 时：挂 `AI 生成` 标签 + 把预编剧本步骤**同步**写入 activities（kind='ai'）。
无真实 LLM、无队列、无 webhook——`dispatchAgentTask` 是未来真实 worker 的扩展点。

## MCP 设计

鉴权改为 DB key 模型（`mcp_api_keys` 表，存 sha256，不存明文）：
- **公司级 key**（companyId 非空）：钉死在该公司沙箱内，自动隔离；
- **平台级 key**（companyId NULL）：可跨公司，工具带可选 `companyId` 参数（默认第一个公司）；
- env `MCP_API_KEY` 仅作平台级兜底（开发兼容），seed 时已迁移为平台级 DB key；
- MCP 调用的 Actor = 目标公司的内置 `scribe` agent member，companyRole=company_admin。

详见 [MCP.md](./MCP.md)。

## Notion 集成

公共 OAuth 集成 + REST API（`Notion-Version: 2022-06-28`），单向 Notion → Issues，手动触发（独立页 /integrations 的「Notion 集成」卡片，无定时任务）。env `NOTION_CLIENT_ID/SECRET` 未配置时功能关闭（连接按钮禁用）。

- **连接**：`/integrations/notion/authorize`（nonce cookie CSRF，同 Lark 绑定流）→ Notion 授权 → `/callback` 用 Basic auth 换 token，按公司 upsert `notion_connections`（**每公司一条**；accessToken 仅服务端保存，任何 API 都不序列化它）。token 不过期，无 refresh。断开 = 删连接行，`notion_issue_links` 随 cascade 清除。
- **同步**（`src/server/services/notionSync.ts`，以点击用户的 Actor 调现有 `createIssue`/`updateIssue`/`registerAttachment`，RBAC 与活动日志复用）：数据库按 `last_edited_time` 倒序翻页、越过 `lastSyncedAt` 水位即停；逐条处理，单条失败记 `errors` 继续，结束后推进水位。幂等靠 `notion_issue_links`（(connectionId, notionPageId) ↔ issueId + 页面编辑时间）。
- **字段映射**（v1 按客户「CRM Requests」库结构硬编码属性名）：展示 key←`Id`（unique_id，如 `CRM-518`；缺失才按类型自动分配）；标题←`Name`；描述←`Request Description` 纯文本 + 每次更新重生成的头行（`Notion: CRM-N · 状态 · url`）；状态←`Status`（Not started→todo / In progress、More info needed→in_progress / Ready for testing→testing / Done、Closed→done / No progress→canceled；归档优先→canceled；未知名创建按 todo、更新不动）；类型←`Tags`（BUGS→bug，Feature/Updated/Change→ticket，默认 bug）；指派人←`Assigned To` 第一人 email 先经 `user_emails`（主/备，大小写不敏感）匹配平台用户的本公司 member 投影，回退 `members.email`（外部邀请/存量行；无 email 能力时更新不动）。老数据追平（页面未变更也执行）：key 追平为 unique_id（被占用则保留原 key 并记入 errors）；映射状态与现值不一致时照常走完整更新。
- **附件**（仅新建时同步，v1 不做 diff）：`Files & media` 里的图片（按扩展名判断）+ 页面 image blocks → 下载（预签名 URL，>10MB 跳过）→ 服务端 `put` 到 Vercel Blob → `registerAttachment`。
