# spms 架构设计

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
spms/
├── drizzle/                    # 迁移文件
├── docs/                       # 项目文档（本目录）
├── scripts/                    # 运维/数据脚本（不走 next 命令；lib/env.ts 为共享引导，加载 .env 并校验 DATABASE_URL）
│   ├── seed.ts                 # 初始数据（admin/agent/演示数据）
│   ├── export-data.js          # 按表导出 PostgreSQL 数据（每表一个文件）
│   ├── import-data.js          # 按表导入（与 export-data.js 配套）
│   ├── reconcile-attachments.ts # 附件存储对账（见下文「文件存储」）
│   ├── migrate-attachments.ts  # 历史附件一次性迁移到新 key 规则（只拷不删，默认 dry-run）
│   ├── migrate-embedded-images.ts # markdown 内嵌图迁移
│   ├── reprovision-policies.ts # 公司 canned policy 双前缀重发 / --tighten 收紧（只动策略）
│   ├── build-mc.sh             # 用一次性 golang 容器从源码构建 MinIO Client（产物 .ci-assets/mc，CI 自动执行）
│   └── prepare-standalone.js   # next build 后把 public 与 .next/static 并入 standalone 产物（挂在 build 脚本尾部）
├── src/
│   ├── db/
│   │   ├── schema.ts           # 全部表 + 枚举 + relations（计数权威文档：docs/DATA-MODEL.md）
│   │   └── index.ts            # postgres-js 连接（DATABASE_URL）
│   ├── lib/                    # 服务端与前端共用的基础库（单一目录，无独立前端 lib）
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
│   │   ├── visibility.ts       # 指派可见性（issueVisible/assertProjectWritable/visibleSetsFor）
│   │   ├── rateLimit.ts        # 内存滑动窗口限流（登录接口按 IP+用户名）
│   │   ├── agents.ts           # AI 演示剧本（同步写 activities）
│   │   ├── activity.ts         # 系统动态（创建/状态流转/归档/指派）的结构化文案
│   │   ├── emails.ts           # user_emails 主/备邮箱规则（登录反查/邀请认领）
│   │   ├── decompose.ts        # 需求按行拆解为工单的解析助手
│   │   ├── notionStatusMap.ts  # Notion Status → SPMS 状态映射/过滤规则
│   │   ├── reportMarkdown.ts   # 日报内容 Markdown 规整（MCP 上报与汇总共用）
│   │   ├── reportHtml.ts       # 日报汇总复制的富文本（HTML）一侧
│   │   ├── markdownInline.ts   # 行内 markdown token 唯一来源（React 渲染与纯文本两侧共用）
│   │   ├── attachments.ts      # 附件类型白名单（图片 + 常见文档格式）+ fileTypeOf 三桶推导（client/server/script 三处共用）
│   │   ├── upload.ts           # 浏览器直传附件到公司存储后端（client-direct）
│   │   ├── i18n.ts + i18n/     # 前端 i18n 字典（zh-CN 默认 / en / zh-TW）
│   │   └── api.ts / platformApi.ts / types.ts / constants.ts / prefs.ts / theme.ts / time.ts / url.ts / utils.ts / useDragHighlight.ts
│   │                           #   前端 API client、类型、常量与 UI 工具（偏好记忆/主题/相对时间/拖拽高亮等）
│   ├── server/
│   │   ├── services/           # 业务服务层（API 与 MCP 共用）
│   │   │   ├── issues.ts  requirements.ts  projects.ts  sprints.ts
│   │   │   ├── catalog.ts resources.ts assignments.ts testcases.ts
│   │   │   ├── labels.ts  plans.ts  testruns.ts  sprintSnapshots.ts  # 自定义标签 / 开发计划 / 测试执行 / 燃尽快照
│   │   │   ├── reports.ts            # 日报（每人每天一份,按产品拆 entries,产品/人员/负责人三维度汇总）
│   │   │   ├── summary.ts            # 团队总结（周期吞吐/周期时长/验收积压/流动健康/按成员分列,读 issue_status_transitions）
│   │   │   ├── attachments.ts        # issue/用例/需求附件（storage.assertMeta 三段比对校验注册 url/objectKey；attachmentReadTarget 统一解析读取目标——objectKey/旧行公网 url，REST 代理与 MCP 图片内联共用）
│   │   │   ├── notionSync.ts         # Notion → Issues 同步（lastSyncedAt 水位增量 / ?full=1 全量，幂等靠 notion_issue_links）+ 连接管理
│   │   │   ├── platform.ts           # 平台管理（公司/成员/矩阵/MCP key）
│   │   │   ├── seats.ts              # 席位（memberships ⋈ users：列表/改角色/回收，末位 company_admin 保护）
│   │   │   ├── storage.ts            # 公司文件存储配置（设置→偏好 状态卡；读/存/测/删 + 一键开通编排，敏感字段加密落库）
│   │   │   ├── oauth.ts              # 三方登录提供方配置 + OAuth callback 账号编排（绑定/邮箱匹配/建号/邀请认领）
│   │   │   ├── workflow.ts           # 审查/关单工作流自动化（REST 与 MCP 共用）
│   │   │   ├── meta.ts               # bootstrap 聚合（REST 与 MCP 共用的单一查询实现；MCP 侧只裁剪字段 + 叠加令牌白名单）
│   │   │   ├── shared.ts             # service 层共享小工具（LIST_LIMIT/withRelations/key 解析）
│   │   │   └── types.ts              # service 层共享类型（Actor 等）
│   │   ├── http.ts             # 路由底座（route 包装 / requireActor / jsonBody / 平台管理员门）
│   │   ├── validate.ts         # zod 校验层（REST 写端点入口 schema 按域集中；jsonBodyWith → VALIDATION_FAILED）
│   │   ├── crypto.ts           # AES-256-GCM 配置密钥加解密（CONFIG_CRYPTO_KEY；OAuth secret / 存储凭据密文落库）
│   │   ├── lark.ts             # 三方登录 provider 抽象（飞书/Lark/GitHub，env 未配置即停用）
│   │   ├── notion.ts           # Notion public-integration OAuth + REST helpers（连接/预览/同步共用）
│   │   ├── params.ts           # assignments 路由族共享的 query/body 校验
│   │   └── storage/            # 两级文件存储（平台 MinIO 唯一后端 + 总开关；公司行恒优先，开通物化按前缀隔离的 IAM 账号）
│   │       ├── index.ts        # storageForCompany(companyId)：总开关/开通闸门 → 配置行 60s 缓存 + 解密构造后端
│   │       ├── minio.ts        # MinIO/S3：presigned PUT 直传 / presigned GET / putObject / removeObject / 前缀探测
│   │       ├── mc.ts           # mc CLI 封装（临时 --config-dir、--json、超时、错误脱敏；admin 操作无维护中的 JS SDK）
│   │       ├── provision.ts    # 公司隔离开通：canned policy（前缀授权）+ IAM 用户 + 物化公司行（provisioned='auto'）
│   │       └── types.ts        # StorageBackend 接口、配置类型与对象 key 五级规则
│   ├── mcp/                    # server.ts（McpServer + tools/prompts 注册的薄适配层；工具清单见 docs/MCP.md）
│   ├── app/
│   │   ├── (auth)/login/       # 登录页（密码 + 飞书/Lark/GitHub OAuth）
│   │   ├── (app)/              # 主应用（Header + Sidebar 布局 + AuthGate）
│   │   │   ├── issues/  issues/[key]/  products/  requirements/  requirements/[key]/
│   │   │   ├── testcases/  testcases/[id]/  projects/  projects/[id]/  resources/
│   │   │   ├── roadmap/  backlog/  backlog/[key]/  sprints/  sprints/[id]/
│   │   │   ├── my-issues/  my-issues/[key]/  # 我的 issue（含详情）
│   │   │   ├── guide/            # 使用指引页
│   │   │   ├── reports/          # 日报（写日报 + 产品/人员/负责人三维度汇总上报）
│   │   │   ├── summary/          # 团队总结（每日/每周两个页签;模块门复用 reports）
│   │   │   ├── integrations/     # 集成页（Notion 连接/预览/同步管理）
│   │   │   ├── settings/  settings/[tab]/  # 设置页 8 个 Tab（路径段驱动）：偏好（所有用户，含本公司存储状态卡）；附件（本公司附件总表，任一附件宿主模块有读权限可见）；公司/成员/矩阵/三方登录/平台存储（平台管理，仅平台管理员）；公司矩阵（公司管理员）
│   │   │   ├── platform/         # 兼容重定向页（companies/members/matrix → /settings/*，keys → /agent-access）
│   │   │   ├── agent-access/     # Agent 接入页（MCP 令牌自助管理，所有登录用户；member 仅自己的公司级 key）
│   │   │   ├── profile/  profile/[tab]/  # 个人资料页（资料/安全/已授权应用三 Tab，路径段驱动）
│   │   ├── api/v1/pms/**/route.ts   # 业务 API（路径与原系统一致）
│   │   ├── api/v1/pms/integrations/**/route.ts # 集成 API（Notion OAuth authorize/callback + 连接/预览/同步）
│   │   ├── api/v1/platform/**/route.ts # 平台管理 API（仅平台管理员；mcp-keys 支持 member 自助）
│   │   ├── api/auth/           # login/logout/session/switch-company/change-password/emails/profile/[provider]/*/oauth/*
│   │   ├── api/health/         # 健康检查
│   │   └── mcp/route.ts        # MCP Streamable HTTP 端点
│   ├── components/             # ui/ glyphs/ menus/ inline/ common/ DetailDrawer/ Header/ Sidebar/
│   │                           #   AttachmentSection（三实体共用的附件区）/ ImageLightbox（图片灯箱）
│   │                           #   platform/（设置页管理面板 Companies/Members/Keys/Matrix/OAuthProviders + 席位抽屉与各弹窗）
│   │                           #   settings/（StoragePanel 平台存储面板 + StorageInfoCard 本公司存储状态卡 + AttachmentsPanel 附件总表 + common）
│   │                           #   profile/（改密码表单 + 邮箱管理卡）
│   │                           #   + 各页面视图（IssuesView/ProjectHub/ScrumViews/ReportsView/…，无独立 views/ 目录）与详情抽屉
│   └── store/                  # React Query hooks + AppDataProvider
└── .env.local                  # DATABASE_URL / SESSION_SECRET / MCP_API_KEY / LARK_* / GITHUB_*
```

## 响应信封与错误约定

- 业务结果一律 HTTP 200 + `{ ok:true, data }` 或 `{ ok:false, error:{ code, message } }`
- 真实状态码仅用于 401（未登录）/ 403（权限不足）/ 404（路由不存在）/ 500
- 详情查询（issue/requirement/testcase/sprint）不存在时返回 `ok(null)`，不是 404
- 内部 uuid 不出网：issue/requirement/testCase 的 `id` 字段序列化为展示 key（如 `BUG-3`）

## 输入校验约定（zod 层）

- **新写端点一律先进 zod 层**：REST 写路由用 `jsonBodyWith(req, xxxSchema)` 解析请求体（`src/server/validate.ts`，TKT-22 引入），schema 按域集中在该文件；枚举取自 `db/schema.ts` 的 pgEnum（DB 定义是单一来源），未知字段默认剥离（防 mass-assignment），parse 失败统一 `ApiException('VALIDATION_FAILED', 首条错误信息)`。
- **分层职责**：zod 层管字段形状/必填/枚举/长度/格式；service 只做业务校验——跨表存在性、唯一性、权限门，以及依赖 DB 旧行或归一化结果才能判定的规则（如存储配置「敏感字段不传 = 保留旧值」、邀请认领键 normalizePhone 后判定）。
- MCP 工具的 inputSchema 由 MCP SDK 校验，与 REST zod 层并列；被 MCP 直接调用的 service 保留必要的字段级兜底校验（MCP 路径不经过 REST zod 层）。

## 认证设计

### 密码登录
`POST /api/auth/login { username, password }` → bcrypt 校验 → jose HS256 签名 cookie
`spms_session`（HttpOnly / SameSite=Lax / 7 天），payload `{ uid, username, role, cid }`。
`username` 也接受**任一邮箱**（`user_emails` 主/备，大小写不敏感）——邮箱反查用户后共用同一密码。
`cid` = 当前公司 id，登录时取第一个可见公司；`POST /api/auth/switch-company { companyId }` 重签 cookie 切换（要求目标公司成员或平台管理员）。
登录接口按 IP+用户名做内存滑动窗口限流（`src/lib/rateLimit.ts`：窗口内失败超限 → 429 `RATE_LIMITED`，登录成功清零；计数存进程内 Map，serverless/多实例部署需换共享存储）。
纯 OAuth 账号（`passwordHash='!oauth'`）可在 /profile 安全页**免旧密码直接设置密码**，设置后密码登录开通——密码与飞书/Lark/GitHub 登录由此统一到同一账号。

### 用户邮箱（user_emails）
一个用户可拥有多个邮箱：一个主邮箱（部分唯一索引保证）+ 至多 5 个备用；邮箱全表唯一（一个邮箱只属于一个用户）。无 SMTP，唯一验证来源是 Lark/飞书/GitHub OAuth 返回的邮箱（`verified`）——**只有 verified 邮箱可认领外部邀请/授予席位**；自填邮箱仅作登录标识、展示与 Notion 指派人匹配。管理端点 `GET/POST/PATCH/DELETE /api/auth/emails`（本人自助）；平台管理员建号/加成员时可写主邮箱；规则集中在 `src/lib/emails.ts`。

### 第三方 OAuth 登录（飞书 / Lark / GitHub）
通用框架：`src/server/lark.ts`（provider 抽象，env 未配置对应变量时该 provider 停用）+ `src/app/api/auth/[provider]/{login,callback,bind}` 动态路由。
1. 登录页按钮跳转各 provider 授权页：飞书/Lark → `<apiBase>/open-apis/authen/v1/authorize?app_id=...&redirect_uri=...`（飞书页面展示扫码）；GitHub → `https://github.com/login/oauth/authorize?client_id=...&scope=read:user user:email`
2. 回调 `/api/auth/<provider>/callback?code=...`：
   - 飞书/Lark：`app_access_token`（tenant 凭证）→ 用 code 换 `user_access_token` → 拉 `user_info`；GitHub：code 换 `access_token` → 拉 `/user` + `/user/emails`（邮箱取 primary+verified 优先）
   - 按稳定身份找 user（飞书 → `feishuUnionId`，Lark → `larkUnionId`——两个独立平台、同一自然人各有一个 union_id，分列存储互绑不覆盖；GitHub → `githubId`，数字 id 转字符串）；不存在则**按 IdP 邮箱逐个匹配已有账号**（个人+企业邮箱，user_emails 主/备优先，其次用户名恰为该邮箱——IdP 已证明邮箱归属），命中即把身份绑到该账号而非新建；仍无匹配才自动创建 user（同名 member 懒绑定）
   - IdP 回传的全部邮箱经 `upsertVerifiedEmail` 登记进 `user_emails`（verified，首个邮箱自动成为主邮箱），并按全部邮箱 + 手机号认领「邀请外部资源」预埋的 members 行（无邮箱账号——如豆包系飞书账号——走手机号认领，需应用开通 `contact:user.phone:readonly`；老用户每次登录都会重试认领）
   - 写 session cookie，跳 `/issues`
3. 某个 provider 的 env（`FEISHU_APP_ID/FEISHU_APP_SECRET`、`LARK_APP_ID/LARK_APP_SECRET`、`GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET`，均可选 `*_REDIRECT_URI` 覆盖——只填路径部分，host 由 `PUBLIC_ORIGIN`/请求 origin 拼接）未配置时，登录页隐藏对应入口（前端通过 `/api/auth/oauth/config` 探测）
4. 绑定模式：已登录用户经 `/api/auth/<provider>/bind`（nonce cookie 防 CSRF）把身份挂到当前账号；解绑 `POST /api/auth/oauth/unbind { provider }`，无密码账号解绑最后一个身份时拒绝（防锁死）

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
- **邀请外部资源（按邮箱/手机号）**：邮箱已属于平台用户（`user_emails` 主/备）→ 直接落 `userId`、转 internal/active 并授 viewer 席位（与 OAuth 认领同结果）；否则预埋 external/invited 行，等本人 OAuth 登录按 verified 邮箱或手机号认领（手机号无平台级 user_phones 表，邀请时不做即时匹配，认领只走 OAuth 回传）。

**角色×模块矩阵**（`src/lib/permissions.ts`）：
- 4 个可配置角色 × 11 个模块（issues/products/requirements/testcases/projects/resources/roadmap/backlog/sprints/agents/reports）× 3 档（`none < read < write`）
- 矩阵存 `role_permissions` 表，**两层拆分**：`companyId=''` 为全局默认（平台管理员在 /settings/matrix 配置），`companyId=<公司>` 为本公司覆盖（company_admin 在 /settings/company-matrix 配置，`/api/v1/pms/permissions-matrix`）；生效值 = 全局 + 按单元格覆盖
- `company_admin` 与平台管理员恒全权限，不入矩阵；缺失行按 `none` 处理；进程内按公司缓存 60s
- **项目创建/删除**额外限定 `company_admin` 或平台管理员（不受矩阵 projects=write 影响）

**权限门**：services 每个入口 `requirePerm(actor, module, 'read'|'write')`，不足抛 `FORBIDDEN`（403）。
前端经 `GET /api/auth/session`（或 bootstrap）拿到 `permissions`（当前用户各模块有效级别），按此过滤侧边栏与按钮。

**指派可见性**（`src/lib/visibility.ts`，四期）：模块读权限之上再按「研发资源指派」收窄——project/sprint 对成员可见 ⟺ 该成员在其上有 `resource_assignments` **direct** 行，仅保留两个有限例外：加入 sprint → 其 project 可见（便于导航）；加入 project → 其下全部 sprint 可见。**祖先（product/release）direct 不下放**——产品/版本级成员不会自动看到其下项目的 issue，项目需单独指派；release/product 之间保持下放（product direct → 其 release 可见，作导航壳与需求管理层）。平台管理员/company_admin 豁免；无任何 direct 指派的普通成员看不到任何节点（严格模式）。应用点：bootstrap 与 issues/requirements/testcases/sprints/catalog 的 list + 详情（范围外按「不存在」处理），MCP 与令牌白名单 `allowedProjectIds` 取交集。产品线不过滤（导航壳，不在指派节点内）；`projectId` 为 NULL 的 issue 视为公司级不过滤；成员池/assignments 服务本身不过滤（管理入口需见全池）。只挡「看」，写操作权限不变。

默认矩阵（seed 写入全局层，可在 /settings/matrix 改）：

| 角色 | write 模块 | read 模块 | none |
|---|---|---|---|
| product_manager | issues/products/requirements/projects/resources/roadmap/backlog/reports | testcases/sprints/agents | — |
| developer | issues/backlog/sprints/reports | 其余全部 | — |
| tester | issues/testcases/reports | 其余大部分 | agents |
| viewer | — | 全部 | — |

## 指派传播代数（核心复用逻辑）

生命周期树：**product_line → product → release → project → sprint**（product_line 不是指派节点）。唯一的多父节点例外：sprint 可跨多个 project（`sprint_projects` 多对多），祖先遍历沿全部项目父链扇出（BFS 去重）。

不变式：成员在节点 N ⟺ 在 N 或 N 的某后代有 direct 指派 ⟹ 出现在 N 的所有祖先上（propagated）。

- `assignMember(N, member, role)`：N 上 upsert direct → 祖先链补 propagated（不动已有 direct）
- `unassignMember(N, member)`：删 N + 全部后代的行 → 由近及远 GC 祖先 propagated（后代无 direct 才删）
- 删节点前必须先 `clearSubtreeAssignments`（要读还在的子节点）
- lead 双写：product/project 的 `leadId`/`aiLeadId` 列与 assignments 表同步（编辑弹窗 select 写列 + `assignMember` lead）；反向——产品/项目/迭代的资源选择弹框统一为皇冠选择框（`ResourcePanelCompact`：皇冠=负责人、勾选=普通成员），皇冠（`updateRole`）保持单 lead 语义并与 `products.leadId`/`projects.leadId` 联动：设为 lead 时同节点其他 lead 降级 member 并回写 leadId，取消 lead 且 leadId 仍指向该成员时置 null；sprint/release 无 leadId 列只降级。role 变更不传播

## 进度派生（rollup）

- `progressOf(issues)`：有 storyPoints 按点数加权，否则按计数；只认 `done`（不含 canceled）
- bootstrap 时 `computeRollups()` 现算 projects/releases 的 progress（纯派生值随响应下发，无存储列）
- Sprint velocity：completed 状态 sprint 的完成点数均值；burndown：ideal 线性 + sprint_snapshots actual（快照只在变更时写入，无变更日 actual 无锚点、前端把相邻锚点直线相连——见 DATA-MODEL.md sprint_snapshots 段）

## AI Agent 演示

4 个内置 agent member：atlas（规划）/ forge（开发）/ sentry（测试）/ scribe（文档）。
issue 指派给 agent 时：挂 `AI 生成` 标签 + 把预编剧本步骤**同步**写入 activities（kind='ai'）。
无真实 LLM、无队列、无 webhook——`dispatchAgentTask` 是未来真实 worker 的扩展点。

## MCP 设计

鉴权改为 DB key 模型（`mcp_api_keys` 表，存 sha256，不存明文）：
- **公司级 key**（companyId 非空）：钉死在该公司沙箱内，自动隔离；
- **平台级 key**（companyId NULL）：可跨公司，工具带可选 `companyId` 参数（默认第一个公司）；
- env `MCP_API_KEY` 仅作平台级兜底（开发兼容），seed 时已迁移为平台级 DB key；
- MCP 调用的 Actor：**DB key → 令牌所属人**（`ownerId`，默认创建人，可在 /agent-access 修改），companyRole 取所属人在目标公司的真实 membership 角色（平台管理员无 membership 时按 company_admin），写操作同时受所属人 RBAC 与 key 能力上限（capabilities）约束；**env 兜底 key**（无所属人）保留遗留行为——Actor = 目标公司的内置 `scribe` agent member，companyRole=company_admin。

详见 [MCP.md](./MCP.md)。

## Notion 集成

公共 OAuth 集成 + REST API（`Notion-Version: 2022-06-28`），单向 Notion → Issues，手动触发（独立页 /integrations 的「Notion 集成」卡片，无定时任务）。env `NOTION_CLIENT_ID/SECRET` 未配置时功能关闭（连接按钮禁用）。

- **连接**：`/integrations/notion/authorize`（nonce cookie CSRF，同 Lark 绑定流）→ Notion 授权 → `/callback` 用 Basic auth 换 token，按公司 upsert `notion_connections`（**每公司一条**；accessToken 仅服务端保存，任何 API 都不序列化它）。token 不过期，无 refresh。断开 = 删连接行，`notion_issue_links` 随 cascade 清除。
- **同步**（`src/server/services/notionSync.ts`，以点击用户的 Actor 调现有 `createIssue`/`updateIssue`/`registerAttachment`，RBAC 与活动日志复用）：数据库按 `last_edited_time` 倒序翻页、越过 `lastSyncedAt` 水位即停；逐条处理，单条失败记 `errors` 继续，结束后推进水位。幂等靠 `notion_issue_links`（(connectionId, notionPageId) ↔ issueId + 页面编辑时间）。
- **字段映射**（v1 按客户「CRM Requests」库结构硬编码属性名）：展示 key←`Id`（unique_id，如 `CRM-518`；缺失才按类型自动分配）；标题←`Name`；描述←每次更新重生成的头行（`Notion: CRM-N · 状态 · url`）+ `Request Description` 纯文本 + 页面正文 blocks 纯文本（顶层，不递归子块）；状态←`Status`（Not started→todo / In progress、More info needed→in_progress / Ready for testing→testing / Done、Closed→done / No progress→canceled；归档优先→canceled；未知名创建按 todo、更新不动）；类型←`Tags`（BUGS→bug，Feature/Updated/Change→ticket，默认 bug）；指派人←`Assigned To` 第一人 email 先经 `user_emails`（主/备，大小写不敏感）匹配平台用户的本公司 member 投影，回退 `members.email`（外部邀请/存量行；无 email 能力时更新不动）。老数据追平（页面未变更也执行）：key 追平为 unique_id（被占用则保留原 key 并记入 errors）；映射状态与现值不一致时照常走完整更新。
- **附件**（仅新建时同步，v1 不做 diff）：`Files & media` 里的图片（按扩展名判断）+ 页面 image blocks → 下载（预签名 URL，>10MB 跳过）→ 服务端 `put` 到**本公司配置的存储后端**（`storageForCompany`，对象 key 的 userSegment 固定保留字 `system`，DB `uploadedById` 仍记同步操作人作审计）→ `registerAttachment`。

## 文件存储（平台级 MinIO 唯一后端 + 公司隔离账号）

附件存储后端已收敛为 **MinIO（S3 兼容，自托管）唯一后端**——Vercel Blob 已移除（TKT-213），旧数据仅保留 302 只读兼容（见下）；ATTACHMENT-REKEY（PLAN-8）把对象 key 重键为 `{companyId}/{category}/{userSegment}/{fileType}/{uuid}-{safeName}` 五级规则，并把附件能力从仅 issue 泛化到 **issue / 测试用例 / 需求** 三类实体（`attachments` 表三 FK 恰一非空，CHECK 约束，见 DATA-MODEL.md）：

- **平台级**：`platform_storage_configs` 表（单行），平台管理员在 设置→平台存储 维护，是全平台唯一的存储配置来源；`enabled` 为平台总开关——`false` 时全平台存储**读写全禁**（`STORAGE_DISABLED`）。
- **公司级**：`company_storage_configs` 表，公司行恒优先于平台行；行由「开通」物化（`provisioned='auto'`）——两条入口走同一 provision 流程：公司管理员在 设置→偏好 底部状态卡一键开通（`POST /api/v1/pms/storage-config`，幂等不覆盖），或平台管理员在 设置→公司管理 手动「开通存储」（`POST /api/v1/platform/companies/:id/storage`，支持 `force=true` 覆盖=密钥轮换）；公司管理员也可 `PUT /api/v1/pms/storage-config` 保存手动 MinIO 配置（覆盖自动开通行；历史手动配置行 `provisioned IS NULL` 继续生效）。
- **闸门规则**（`storageForCompany`，所有存储读写的唯一收口）：平台行 `enabled=false` → `STORAGE_DISABLED`（读写全禁）；有公司行 → 用之；无公司行、有平台行 → `STORAGE_NOT_PROVISIONED`（提示联系平台管理员开通）；两级都无 → `STORAGE_NOT_CONFIGURED`。运行时无惰性开通。

### MinIO 租户隔离（共享 bucket + 按前缀授权的 IAM 用户，开通物化）

平台默认 MinIO 时，公司为粒度做**凭据级物理隔离 + MinIO 服务端权限强制**，而不是只靠应用层自觉：

- **模型**：所有公司共用一个私有 bucket（平台配置指定）；每个公司一对独立 IAM 用户（`spms-<cid8>`）+ 一条 canned policy（`spms-co-<cid8>`），策略只允许 `s3:GetObject/PutObject/DeleteObject` 等作用于 `arn:aws:s3:::<bucket>/{companyId}/*`（ListBucket 带 `s3:prefix` 条件）——公司 ID 提为 key 第一段后，一段前缀即覆盖该公司全部附件对象（issues/cases/requirements 天然入隔离域）。拿 A 公司密钥读 B 公司对象，MinIO 直接 AccessDenied。**重键过渡期双前缀**：重键前的存量对象在旧前缀 `issues/{companyId}/*` 下，`companyPolicyDocument(bucket, cid, { includeLegacy: true })` 额外放行该前缀（迁移窗口内旧 key 仍可读删）；已开通公司由 `scripts/reprovision-policies.ts` 默认双前缀重发并逐公司回读校验，用户手动删完旧对象后以 `--tighten` 重跑收紧为仅 `{companyId}/*`。
- **开通物化**（`src/server/storage/provision.ts`）：公司管理员一键开通（`POST /api/v1/pms/storage-config`）或平台管理员手动开通（`POST /api/v1/platform/companies/:id/storage`，body `{ force? }` 可省略）触发同一流程——`mc mb --ignore-existing` 确保 bucket → `mc admin policy create` 写入前缀策略（新开通只写 `{companyId}/*` 单前缀，不含 legacy）→ `mc admin user add` 生成随机密钥的用户 → `mc admin policy attach` 绑定 → 用受限凭据在公司前缀下 put/del 探测端到端验证 → 探测通过后把凭据（AES-256-GCM）物化进 `company_storage_configs`（`provisioned='auto'`，endpoint/bucket/publicBaseUrl 拷贝自平台行）。默认幂等（已有公司行，含历史手动配置行，直接返回不覆盖）；平台侧 `force=true` 重跑并覆盖行（`mc admin user add` 覆盖密钥 = 密钥轮换；**旧凭据即丢**，手动行公司 force 重开通前必须先 `migrate-attachments.ts --backup-configs` 快照）。运行时**无惰性开通**（公司无行即 `STORAGE_NOT_PROVISIONED`）；进程内按公司互斥，竞态由「MinIO 侧后写覆盖 + 探测不过不落行」收敛。
- **平台凭据要求**：必须有 MinIO 管理员权限（建用户/策略是 admin 操作）——root，或专用 `spms-provisioner` 用户。最小准备命令（运维一次执行）：
  ```bash
  mc alias set myminio https://<endpoint> <rootAK> <rootSK>
  mc admin user add myminio spms-provisioner <strongSecret>
  mc admin policy attach myminio consoleAdmin --user spms-provisioner
  ```
  设置页的「测试连接」会完整验证：bucket 不存在则创建 + 根目录写删探测 + `mc admin user list` 管理员能力校验。
- **mc 依赖**：admin 操作无维护中的 JS SDK（官方仅 Go madmin，且建用户/绑策略负载走 DARE 加密），实现选择 shell 调 `mc`（`src/server/storage/mc.ts`：临时 `--config-dir`、`--json`、15s 超时、错误脱敏）。社区版已不再发布预编译二进制（仅源码分发）：mc 由 `scripts/build-mc.sh` 用一次性 golang 容器从源码构建（`MC_REF` 钉版本、`GOPROXY` 可换代理），产物 `.ci-assets/mc` 在镜像构建期拷入（Dockerfile 为 runtime-node 单段模式，编译不出现在镜像构建中）；本地开发需 `go install github.com/minio/mc@latest`（Go ≥ 1.23）。
- **孤儿回收**：删除公司只 cascade 删 DB 行，MinIO 侧用户/策略/对象保留，运维手动清理：
  ```bash
  mc admin user remove myminio spms-<cid8>
  mc admin policy remove myminio spms-co-<cid8>
  mc rm --recursive --force myminio/<bucket>/<companyId>/
  # 重键前的旧对象另在 legacy 前缀下（过渡期未清理时）：
  mc rm --recursive --force myminio/<bucket>/issues/<companyId>/
  ```

### 对象 key 规则与应用层隔离

- **key 规则（五级段序，服务端铸造）**：`{companyId}/{category}/{userSegment}/{fileType}/{uuid}-{safeName}`（`src/server/storage/types.ts`），客户端不能指定任何一段：
  - `companyId`——第一段即公司隔离边界（IAM 策略一段前缀覆盖公司全部对象）；
  - `category`——归属实体 `issues` / `cases` / `requirements`，由实体类型经服务端单点映射（注册路由按实体固定；上传意图入参是受限枚举，默认 `issues`）；
  - `userSegment`——上传人 memberId（服务端取自 actor，客户端不可指定）；Notion 同步来源与无 member 投影的操作者落保留字 `system`（member id 是 uuid，不会撞保留字）；历史行迁移时取 `uploadedById ?? 'system'`；
  - `fileType`——由 contentType(MIME) 三桶推导（`fileTypeOf()`，`src/lib/attachments.ts`，client/server/script 三处共用）：`image/*` → `images`，文档 allow-list → `documents`，其余/空 → `others`；不做魔数嗅探，新上传已过 allow-list 校验实际只落 images/documents，`others` 仅为历史脏 contentType 行兜底；
  - `uuid` 保证唯一（不依赖随机后缀），`safeName` 沿用 sanitizer 保持可读。
- **双格式兼容（`LEGACY-KEY:` 标记分支）**：重键前旧 key `issues/{companyId}/{uuid}-{safeName}` 在过渡期内**可读可删**——`assertOwnKey` / `companyIdFromKey` 双格式解析（仅读/删路径）；写路径（`put` / `createUploadIntent` / `assertMeta`）只产新格式、只认新格式。兼容分支统一标 `LEGACY-KEY:` 注释，待旧对象手动清理且策略 tighten 后另行删除。
- **公司隔离**：上传签发、注册校验（`storage.assertMeta`：key 前缀 + category 段 + userSegment 段三重比对，错 category 或他人 userSegment 的 key 一律 `VALIDATION_FAILED`）、删除、读取都钉死本公司前缀——应用层校验作为 MinIO 策略之外的第二道防线。
- **私有 bucket + 代理读取**：对象不公网可读；所有读取走 `GET /api/v1/pms/attachments/object`（`?id=` 附件行级鉴权 / `?key=` key 内嵌 companyId 比对——`companyIdFromKey` 双格式，新旧 key 均兼容），鉴权后 302 到 MinIO 短时效 presigned GET，`Cache-Control: private, no-cache`。`<img>`、markdown 嵌入图、MCP 读图全部经由它（MCP 走 `storage.get` 直读）。`attachments.url` 存的是后端规范地址（身份标识），`object_key` 存 key；`object_key` 为 NULL 的存量行 = 平台级 Vercel Blob 旧数据（迁移失败/未迁移），代理直接 302 到其存量公网 url（只读兼容，不再依赖任何 Vercel SDK）。
- **浏览器直传**（唯一协议 presigned-put）：`POST /attachments/upload`（`action:'create-intent'`，入参含受限枚举 `category`，默认 `issues`）签发上传意图——MinIO presigned PUT（bucket 需配 CORS 允许本站来源的 PUT），客户端按签发 URL 直传；objectKey 服务端按新规则铸造（userSegment 恒为操作人 memberId，无 member 投影落 `system`）。
- **内外网分离（publicBaseUrl）**：V4 预签名覆盖 host 头，浏览器必须按签发的 host 请求。站点经域名/反代访问时，在配置里填 `publicBaseUrl`（如 `https://s3.innev.cn`）：presigned PUT/GET 与规范 url 都按公网基址签发（专用客户端，region 写死 us-east-1 避免向公网地址发探活请求），服务端 put/get/del 与「测试连接」仍走内网 endpoint；留空 = 纯内网部署，按 endpoint 直签。规范化存储（默认端口省略、无路径无尾斜杠），与 minio-js 渲染规则一致，保证注册时 `assertMeta` 的 url 逐字节匹配。
- **密钥安全**：accessKey/secretKey 经 `src/server/crypto.ts`（AES-256-GCM，密钥 = env `CONFIG_CRYPTO_KEY`）密文落库，平台级与公司级 API 都只回 `hasAccessKey/hasSecretKey`（PUT 不传 = 保留旧值）或标识性 `account`，secret 永不回显。
- **对账**（`scripts/reconcile-attachments.ts`）：遍历有配置的公司逐家对账（MinIO listObjectsV2），无配置公司跳过。重键后语义：list 前缀切到 `{companyId}/`——旧前缀 `issues/{companyId}/` 对象天然不可见，不误报孤儿，也绝不替用户删旧对象；DB 侧不再 join issues，按 `attachments` 三 FK（issue / case / requirement）分列统计；`--min-age-days`（默认 7）护栏跳过最近 N 天内新建的未注册对象不删——评论粘贴图从未注册为附件行（既有缺陷），会被判为孤儿，护栏防刚粘贴的图被误删（根修另立项）。**迁移脚本 apply 完成前不要对本表 `--apply`**：窗口内 DB 行还是旧 key、list 前缀已切，全部存量行会被误判死链。存量旧行（object_key NULL）不再对账——`@vercel/blob` 已移除，VERCEL 死链只报告不处置，清理只删 DB 行、不触碰远端对象。
- **历史迁移**（`scripts/migrate-attachments.ts`，一次性，默认 dry-run）：把三个时代的历史附件**只拷不删**地迁到新规则位置并清洗 DB 行地址。四类源：`NEW_FMT`（objectKey 命中 `^{companyId}/` → 跳过，幂等可反复跑）/ `LEGACY_SHARED`（`^issues/{companyId}/` 且公司行 auto → 同 bucket `copyObject`，字节不落盘）/ `LEGACY_MANUAL`（手动配置行或快照分叉 → 用 `--backup-configs` 快照里的旧凭据建源 client `getObject`）/ `VERCEL`（object_key NULL → 公网 `fetch` 行.url）；`--probe` 可达性探测出预计失败清单（VERCEL 走 HEAD、MinIO 走 statObject）；`--apply` 逐行 取回/拷贝 → 新 key put（写入端用公司 auto 受限凭据，pin `region:'us-east-1'`）→ `UPDATE attachments` 改 url/object_key（url 复用 `minioBackend().canonicalUrl`，不自拼），单行失败记录继续，收尾重扫 + 全部新 key statObject 抽验。红线：脚本无 `removeObject` / `DELETE FROM`，绝不删源对象、绝不删 DB 行；解密凭据只进内存不写日志。配套 `scripts/reprovision-policies.ts` 只动 canned policy（双前缀重发 / `--tighten` 收紧，create-or-replace 防御 + 回读逐字节校验），不碰 IAM user / secret / DB 行 / 对象。

## 三方登录（设置 → 三方登录，平台级）

飞书/Lark/GitHub 凭据存 `oauth_provider_configs` 表（`appSecretEnc` 密文），平台管理员在设置页维护；读取 DB 优先、env 兜底（60s 进程缓存，写后失效）。登录页按钮显隐仍由 `GET /api/auth/oauth/config` 决定。
