# spms

用 **Next.js 全栈**重写的 SPMS 研发管理系统（需求 / 任务 / 缺陷 / 迭代 / 测试用例 / 产品生命周期 / 研发资源池），并内置 **HTTP Streamable MCP 服务**，让 Agent 可以直接连接并读写研发数据。

功能对齐原 SPMS 前后端，去掉了多租户与 portal 依赖。

## 功能

- **多公司沙箱**：公司即独立数据空间（编号/成员/业务数据全隔离），Header 一键切换；现有数据在「默认公司」，另有「示例公司」空沙箱
- **RBAC 权限**：平台角色（管理员/普通用户）+ 公司内 5 角色（管理员/产品/开发/测试/访客）；4 角色 × 10 模块 × 3 档权限矩阵拆两层——全局默认（平台管理员配）+ 本公司覆盖（公司管理员在 设置 → 权限矩阵·本公司 配）；侧边栏与按钮按权限过滤
- **席位体系**：平台管理员在 设置 → 成员管理 看全部系统用户并新建账号；公司卡片 → 席位 抽屉把用户分配进/回收出公司沙箱（默认访客）；公司管理员在 研发资源 → 内部成员 调整公司角色/移除席位
- **平台管理**：`/settings` 设置页 Tab——公司管理（含席位）、成员管理（平台成员目录）、权限矩阵·全局、Agent 接入（仅平台管理员可见，旧 `/platform` 路由重定向至此）
- **Issue 统一工作项**：缺陷（bug）/ 工单（ticket）/ 备忘（backlog）三合一；列表/看板双视图、分组（状态/优先级/重要度/负责人）、看板拖拽、行内编辑、详情抽屉（子任务/评论/@提及/活动流/AI 工作区）
- **需求池**：功能/非功能需求（FR-N / NFR-N），PRD 描述 + 验收标准，关联 Issue 完成度
- **项目**：卡片网格（进度环、PLC 阶段步进条）+ 项目枢纽 6 tab（基本信息/研发资源/需求/用例/迭代/Issue）；创建/删除需 company_admin 或平台管理员
- **敏捷**：Backlog 拖拽规划、迭代看板、燃尽图、速度图；迭代 CRUD
- **产品目录**：产品线 → 产品 → 版本三级生命周期管理（级联删除确认）
- **研发资源池**：内部成员 / 外部挂名资源 / 4 个内置 AI Agent；虚拟团队指派沿生命周期传播（direct/propagated）
- **全局**：52px 全局 Header（公司切换器 + 角色 Badge + 全局搜索 ⌘K + 用户下拉[个人资料/浅色模式/退出登录]）、侧边栏底部「设置 / 个人资料」入口、快速新建（`c`）、浅色主题（可在设置页切深色/跟随系统）、中文界面；`/profile` 个人资料页（资料/安全/已授权应用三 Tab）支持改名与改密码
- **MCP**：20 个 `spms_*` tools（11 读 + 9 写），DB key 鉴权（公司级自动隔离 / 平台级跨公司），见 [docs/MCP.md](docs/MCP.md)

## 快速开始

```bash
# 1. 准备 PostgreSQL 并配置环境变量
cp .env.example .env.local   # 修改 DATABASE_URL 等

# 2. 安装依赖
npm install

# 3. 初始化数据库（迁移 + 种子数据）
npm run db:migrate
npm run db:seed

# 4. 启动
npm run dev
```

打开 http://localhost:3000 ，种子账号：**admin / admin123**（平台管理员 + 默认公司 company_admin）。种子数据含「默认公司」（历史演示数据）与「示例公司」（空沙箱）。

### 环境变量

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串（如 `postgres://postgres:postgres@localhost:5432/spms`） |
| `SESSION_SECRET` | session cookie 签名密钥（随机长串） |
| `MCP_API_KEY` | MCP 鉴权 key 的**平台级兜底**（逗号分隔多个，均视为平台级）；seed 时已迁移为 DB 平台级 key。**推荐使用 DB key**（见下） |
| `LARK_APP_ID` / `LARK_APP_SECRET` / `LARK_REDIRECT_URI` | 可选，飞书扫码登录；未配置时登录页不显示飞书入口 |
| `SEED_ADMIN_PASSWORD` | 可选，覆盖种子 admin 密码（默认 admin123） |

## MCP 接入

端点：`http://localhost:3000/mcp`（Streamable HTTP），鉴权头 `Authorization: Bearer <key>`。

**推荐**：登录后到侧边栏 **Agent 接入**（`/agent-access`）签发 key：普通成员自助签所属公司范围的公司级 key（不选公司 = 当前公司）；平台管理员还可签平台级 key（不选公司 = 平台级）。明文仅签发时显示一次；env `MCP_API_KEY` 仅作平台级兜底。公司级 key 只读写本公司数据；平台级 key 可用工具的 `companyId` 参数指定目标公司（默认第一个公司）。

```json
{
  "mcpServers": {
    "spms": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer <在 /agent-access 签发的 key>" }
    }
  }
}
```

工具示例：`spms_list_companies`、`spms_list_issues {"type":"bug"}`（缺陷列表）、`spms_create_issue`、`spms_update_issue`、`spms_list_requirements`、`spms_create_requirement`、`spms_move_issue_to_sprint` 等，完整清单见 [docs/MCP.md](docs/MCP.md)。

## 技术栈

Next.js 16（App Router）· TypeScript · Tailwind v4 · React Query · Drizzle ORM（PostgreSQL）· @modelcontextprotocol/sdk · jose · bcryptjs

## 文档

- [docs/PLAN.md](docs/PLAN.md) — 项目规划与实施阶段（一期 + 二期多公司沙箱/RBAC/Header）
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 架构设计（分层 / 认证与 RBAC / 多公司沙箱 / 指派传播 / 进度派生）
- [docs/DATA-MODEL.md](docs/DATA-MODEL.md) — 数据模型（22 表 + 枚举 + 级联）
- [docs/API.md](docs/API.md) — REST API 清单（业务 + 平台管理）
- [docs/MCP.md](docs/MCP.md) — MCP 服务与 tools

## 常用命令

```bash
npm run dev           # 开发
npm run build         # 构建
npm run db:generate   # 生成迁移
npm run db:migrate    # 应用迁移
npm run db:seed       # 种子数据（幂等）
```
