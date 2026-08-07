# spms 项目规划

> 用 Next.js 全栈重写 SPMS 研发管理系统，并提供 HTTP Streamable MCP 服务供 Agent 操作需求、任务、缺陷等。

## 已确认的决策

| 维度 | 决策 |
|---|---|
| 数据库 | PostgreSQL + Drizzle ORM（沿用原 schema，去掉多租户） |
| 认证 | 内置用户表 + 账号密码登录（cookie session）+ 飞书扫码登录；**无租户概念** |
| MCP | HTTP Streamable，挂在 `/mcp` 路由，API key 鉴权 |
| UI | 完全对齐原前端（看板拖拽、燃尽/速度图、命令面板、资源传播 UI 等全保留） |

## 技术栈

- Next.js 16（App Router）+ TypeScript + Tailwind v4
- shadcn 风格组件（从 spms-app 移植）+ Radix primitives + lucide-react
- @tanstack/react-query v5（服务端状态）
- drizzle-orm（postgres-js 驱动 `postgres` 包）+ drizzle-kit
- @modelcontextprotocol/sdk（StreamableHTTPServerTransport）
- jose（session cookie 签名）+ bcryptjs（密码哈希）
- tsx（跑 seed 脚本）

## 实施阶段

### Phase A：脚手架 + DB 层 ✅ 已完成
- create-next-app（TS/Tailwind/App Router/src dir），全部依赖安装
- `src/db/schema.ts`：18 张表（原 16 张去租户 + 新增 `users`、`counters`）
- drizzle 迁移已生成（`npm run db:generate` / `db:migrate` / `db:seed`）
- `scripts/seed.ts`：admin 用户、4 个 AI agent、ai 标签、完整演示数据
- `src/lib/{env,password,keys}.ts`、`.env.example` / `.env.local`
- ✅ 迁移与 seed 已在 `DATABASE_URL`（env，见 `.env.example`）指向的本地库执行完成（admin/admin123 + 演示数据）

### Phase B1：服务端 lib + services ✅ 已完成
- envelope/错误码、session（jose cookie）、serialize、rollup、assignments 传播代数、identity、agents 演示
- `src/server/services/`：issues / requirements / projects / sprints / catalog / resources / assignments / testcases / meta —— 业务逻辑收敛于此，API 路由与 MCP 共用

### Phase B2：API 路由 + 认证 ✅ 已完成
- `/api/v1/pms/**` 全部路由组（路径与原系统一致）
- `/api/auth/{login,logout,session}` + 飞书 OAuth（`/api/auth/lark/callback`）
- middleware 未登录重定向

### Phase C1：前端基础 + Issues 视图 ✅ 已完成
- api client（fetch 直连，信封解包）、types、i18n、ui/glyphs 组件、AppData Provider、store hooks
- Sidebar、登录页、CommandPalette(⌘K)、NewIssueModal(c)
- IssuesView（分组/看板/拖拽/行内编辑）+ IssueDetail 抽屉（`/issues/<KEY>`）

### Phase C2/C3：其余视图 ✅ 已完成
- Sprints（迭代选择器/燃尽图/速度图/四列看板）、Backlog（拖入迭代）、Roadmap（占位甘特）
- Projects 列表 + ProjectHub 6 tab、Requirements、TestCases、Catalog（产品线三级）、Resources + ResourcePanel
- Sprint 创建/编辑弹窗（后端能力本次补齐）

### Phase D：MCP 服务 ✅ 已完成
- `/mcp` 路由（POST/GET/DELETE，Streamable HTTP）
- DB key 鉴权（`mcp_api_keys` 表存 sha256，不存明文：公司级钉死沙箱、平台级跨公司；env `MCP_API_KEY` 仅作平台级兜底；浏览器 session 用户也放行）
- 26 个 `spms_*` tools（读 11 + 写 15），内部复用 services

### Phase E：验证 + 文档 ✅ 已完成
- `npm run build` 绿；dev 冒烟（登录 → bootstrap → 建 issue → 拖拽 → MCP 调用）
- README（启动步骤、env、MCP 接入示例、种子账号）

## 编号规则

统一走 `counters` 表原子递增（修掉原系统 max+1 竞态）；二期起 counters 主键 `(companyId, name)`，**序号按公司独立**：

| 前缀 | 对象 | 序号范围 |
|---|---|---|
| BLG | 备忘 issue | 公司内单序号 |
| TKT | 工单 issue | 公司内单序号 |
| BUG | 缺陷 issue | 公司内单序号 |
| FR | 功能需求 | 公司内独立序号 |
| NFR | 非功能需求 | 公司内独立序号 |
| TC | 测试用例 | 公司内单序号 |
| PL / PD / RL | 产品线 / 产品 / 版本 | 公司内各自单序号 |

## 二期：多公司沙箱 + RBAC + Header ✅ 已完成

### 已确认的决策（二期）

| 维度 | 决策 |
|---|---|
| 多公司 | 公司即沙箱：全部业务表加 `companyId`，唯一键改 `(companyId, key)`，编号按公司独立；现有数据归入「默认公司」(DEFAULT)，另有「示例公司」(SAMPLE) 空沙箱 |
| 角色 | 两层：users.role 平台级（admin=平台管理员）；company_memberships.role 公司级（company_admin + 4 可配置角色） |
| 权限 | 4 角色 × 11 模块 × 3 档矩阵存 `role_permissions`，拆两层（全局默认 + 本公司覆盖）；company_admin/平台管理员恒全权限；项目建删额外限 company_admin/平台管理员 |
| 认证 | session cookie 增加 `cid`（当前公司），switch-company 重签切换 |
| MCP key | DB key（sha256，不存明文）：公司级钉死沙箱、平台级跨公司；env `MCP_API_KEY` 降级为平台级兜底 |
| 前端 | 52px 全局 Header（logo + 公司切换器 + 角色 Badge + 全局搜索 ⌘K + 用户下拉）；UI 按 permissions 过滤 |

### 实施阶段（二期）

- **P1：schema 与迁移** ✅ —— `companies` / `company_memberships` / `role_permissions` / `mcp_api_keys` 4 张新表；业务表加 `companyId` NN；唯一键与 counters 复合 PK 改造；现有数据归入默认公司，admin = 平台管理员 + 默认公司 company_admin，env dev-mcp-key 迁移为平台级 key
- **P2：Actor 与权限门** ✅ —— `requireActor()`（session cid → 公司 + 角色）；`src/lib/permissions.ts` 矩阵读取/60s 缓存/`requirePerm`；services 全量接入
- **P3：认证扩展** ✅ —— session payload 加 `cid`；`/api/auth/switch-company`、`/api/auth/change-password`；session/bootstrap 返回 companies/currentCompany/companyRole/permissions
- **P4：平台管理 API** ✅ —— `/api/v1/platform/**`：companies（GET/POST/PATCH + enter + members CRUD）、permissions-matrix（GET/PUT）、mcp-keys（GET/POST/DELETE）
- **P5：MCP 改造** ✅ —— DB key 鉴权（sha256）+ env 平台级兜底；公司级 key 自动隔离；平台级 key 工具带 `companyId` 参数；新增 `spms_list_companies`（现共 26 个工具）；MCP actor = DB key 所属人（ownerId，companyRole 取真实 membership 角色），env 兜底 key 保留遗留行为（目标公司内置 scribe agent，company_admin）
- **P6：前端 Header 与平台管理页** ✅ —— 52px 全局 Header（公司切换器/角色 Badge/⌘K 全局搜索/用户下拉）；SettingsModal（资料 + 改密码）；`/platform` 四子页（companies/members/matrix/keys，仅平台管理员）；侧边栏与按钮按 permissions 过滤
- **P7：验证 + 文档** ✅ —— build 绿、多公司隔离与 RBAC 冒烟；docs 与 README 更新

## 明确不做

- 多租户、portal 对接（TDT/directory/notification 全部移除）
- 富文本（沿用 plain textarea）
- 真实 LLM 接入（AI agent 仅演示剧本，同步写 activities）
- Roadmap 真实甘特数据（保持占位实现）
- 飞书消息推送（仅扫码 OAuth 登录）

## 环境要求

- Node.js 20+；本地 PostgreSQL（连接串配在 env `DATABASE_URL`，示例见 `.env.example`）
- 可选：飞书开放平台自建应用凭证（`LARK_APP_ID` / `LARK_APP_SECRET` / `LARK_REDIRECT_URI`）
