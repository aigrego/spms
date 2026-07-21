# next-spms 项目规划

> 用 Next.js 全栈重写 SPMS 研发管理系统（参考 `saas-portal/apps/spms-app` + `spms-server`），并提供 HTTP Streamable MCP 服务供 Agent 操作需求、任务、缺陷等。

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
- ✅ 迁移与 seed 已在 `postgres://postgres:postgres@livebook:5433/next_spms` 执行完成（admin/admin123 + 演示数据）

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
- IssuesView（分组/看板/拖拽/行内编辑）+ IssueDetail 抽屉（`?selected=<KEY>`）

### Phase C2/C3：其余视图 ✅ 已完成
- Sprints（迭代选择器/燃尽图/速度图/四列看板）、Backlog（拖入迭代）、Roadmap（占位甘特）
- Projects 列表 + ProjectHub 6 tab、Requirements、TestCases、Catalog（产品线三级）、Resources + ResourcePanel
- Sprint 创建/编辑弹窗（后端能力本次补齐）

### Phase D：MCP 服务 ✅ 已完成
- `/mcp` 路由（POST/GET/DELETE，Streamable HTTP）
- API key 鉴权（`MCP_API_KEY`，逗号分隔多个；浏览器 session 用户也放行）
- 18 个 `spms_*` tools（读 9 + 写 9），内部复用 services

### Phase E：验证 + 文档 ✅ 已完成
- `npm run build` 绿；dev 冒烟（登录 → bootstrap → 建 issue → 拖拽 → MCP 调用）
- README（启动步骤、env、MCP 接入示例、种子账号）

## 编号规则

统一走 `counters` 表原子递增（修掉原系统 max+1 竞态）：

| 前缀 | 对象 | 序号范围 |
|---|---|---|
| BLG | 备忘 issue | 全局单序号 |
| TKT | 工单 issue | 全局单序号 |
| BUG | 缺陷 issue | 全局单序号 |
| FR | 功能需求 | 独立序号 |
| NFR | 非功能需求 | 独立序号 |
| TC | 测试用例 | 全局单序号 |
| PL / PD / RL | 产品线 / 产品 / 版本 | 各自单序号 |

## 明确不做

- 多租户、portal 对接（TDT/directory/notification 全部移除）
- 附件上传、富文本（沿用 plain textarea）
- 真实 LLM 接入（AI agent 仅演示剧本，同步写 activities）
- Roadmap 真实甘特数据（保持占位实现）
- 飞书消息推送（仅扫码 OAuth 登录）

## 环境要求

- Node.js 20+；本地 PostgreSQL（`DATABASE_URL`，当前已配置 `postgres://postgres:postgres@livebook:5433/next_spms`）
- 可选：飞书开放平台自建应用凭证（`LARK_APP_ID` / `LARK_APP_SECRET` / `LARK_REDIRECT_URI`）
