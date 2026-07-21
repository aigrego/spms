# next-spms 架构设计

## 总体架构

```
┌─────────────────────────────────────────────────────────┐
│                     Next.js 16 应用                      │
│                                                         │
│  浏览器 UI (App Router)      Agent (MCP client)         │
│      │                          │                       │
│      ▼                          ▼                       │
│  /api/v1/pms/** (route.ts)   /mcp (Streamable HTTP)     │
│      │                          │                       │
│      └──────┬───────────────────┘                       │
│             ▼                                           │
│   src/server/services/*  （业务逻辑唯一出处）            │
│             ▼                                           │
│   src/lib/* (session/rollup/assignments/keys/...)       │
│             ▼                                           │
│        drizzle-orm ──► PostgreSQL                       │
└─────────────────────────────────────────────────────────┘
```

关键原则：**业务逻辑只写在 services 层**，API 路由和 MCP tools 都是薄适配层，避免逻辑分叉。

## 目录结构

```
next-spms/
├── drizzle/                    # 迁移文件
├── docs/                       # 项目文档（本目录）
├── scripts/seed.ts             # 初始数据（admin/agent/演示数据）
├── src/
│   ├── db/
│   │   ├── schema.ts           # 18 张表 + 20 个枚举 + relations
│   │   └── index.ts            # postgres-js 连接（DATABASE_URL）
│   ├── lib/                    # 服务端基础库
│   │   ├── env.ts              # 环境变量集中读取
│   │   ├── session.ts          # jose HS256 cookie session（7 天）
│   │   ├── password.ts         # bcryptjs 哈希
│   │   ├── envelope.ts         # { ok, data|error } 信封 + 错误码
│   │   ├── keys.ts             # counters 表原子递增编号
│   │   ├── serialize.ts        # id→展示 key 序列化
│   │   ├── rollup.ts           # 项目/版本进度派生
│   │   ├── assignments.ts      # 指派传播代数（direct/propagated）
│   │   ├── identity.ts         # user↔member 懒绑定 + agent 兜底播种
│   │   └── agents.ts           # AI 演示剧本（同步写 activities）
│   ├── server/services/        # 业务服务层（API 与 MCP 共用）
│   │   ├── issues.ts  requirements.ts  projects.ts  sprints.ts
│   │   ├── catalog.ts resources.ts assignments.ts testcases.ts
│   │   └── meta.ts             # bootstrap 聚合
│   ├── mcp/server.ts           # McpServer + tools 注册
│   ├── app/
│   │   ├── (auth)/login/       # 登录页（密码 + 飞书扫码）
│   │   ├── (app)/              # 主应用（Sidebar 布局 + AuthGate）
│   │   │   ├── issues/  products/  requirements/  testcases/
│   │   │   ├── projects/  projects/[id]/  resources/
│   │   │   ├── roadmap/  backlog/  sprints/  sprints/[id]/
│   │   ├── api/v1/pms/**/route.ts   # 业务 API（路径与原系统一致）
│   │   ├── api/auth/           # login/logout/session/lark/*
│   │   └── mcp/route.ts        # MCP Streamable HTTP 端点
│   ├── components/             # ui/ glyphs/ menus/ inline/ Sidebar/ 各详情抽屉
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
`spms_session`（HttpOnly / SameSite=Lax / 7 天），payload `{ uid, username, role }`。

### 飞书扫码登录
1. 登录页按钮跳转 `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=...&redirect_uri=...`（飞书页面展示扫码）
2. 回调 `/api/auth/lark/callback?code=...`：
   - `app_access_token`（tenant 凭证）→ 用 code 换 `user_access_token` → 拉 `user_info`
   - 按 `larkUnionId` 找 user；不存在则自动创建 user（同名 member 懒绑定）
   - 写 session cookie，跳 `/issues`
3. env 未配置 `LARK_APP_ID/LARK_APP_SECRET` 时，登录页隐藏飞书入口（前端通过 `/api/auth/lark/config` 探测）

### 权限模型
- `users.role`：`admin | member`
- 项目创建/删除需 admin（替代原系统的 ACL `spms:action:project.*`）
- 其余操作登录即可

## 指派传播代数（核心复用逻辑）

生命周期树：**product_line → product → release → project → sprint**（product_line 不是指派节点）。

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

见 [MCP.md](./MCP.md)。
