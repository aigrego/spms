# next-spms

用 **Next.js 全栈**重写的 SPMS 研发管理系统（需求 / 任务 / 缺陷 / 迭代 / 测试用例 / 产品生命周期 / 研发资源池），并内置 **HTTP Streamable MCP 服务**，让 Agent 可以直接连接并读写研发数据。

参考蓝本：`saas-portal/apps/spms-app`（前端）+ `saas-portal/apps/spms-server`（后端），功能完全对齐，去掉了多租户与 portal 依赖。

## 功能

- **Issue 统一工作项**：缺陷（bug）/ 工单（ticket）/ 备忘（backlog）三合一；列表/看板双视图、分组（状态/优先级/重要度/负责人）、看板拖拽、行内编辑、详情抽屉（子任务/评论/@提及/活动流/AI 工作区）
- **需求池**：功能/非功能需求（FR-N / NFR-N），PRD 描述 + 验收标准，关联 Issue 完成度
- **项目**：卡片网格（进度环、PLC 阶段步进条）+ 项目枢纽 6 tab（基本信息/研发资源/需求/用例/迭代/Issue）；创建/删除需 admin
- **敏捷**：Backlog 拖拽规划、迭代看板、燃尽图、速度图；迭代 CRUD（本次补齐）
- **产品目录**：产品线 → 产品 → 版本三级生命周期管理（级联删除确认）
- **研发资源池**：内部成员 / 外部挂名资源 / 4 个内置 AI Agent；虚拟团队指派沿生命周期传播（direct/propagated）
- **全局**：命令面板（⌘K）、快速新建（`c`）、暗色主题、中文界面
- **MCP**：19 个 `spms_*` tools（10 读 + 9 写），见 [docs/MCP.md](docs/MCP.md)

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

打开 http://localhost:3000 ，种子账号：**admin / admin123**。

### 环境变量

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串（如 `postgres://postgres:postgres@localhost:5432/next_spms`） |
| `SESSION_SECRET` | session cookie 签名密钥（随机长串） |
| `MCP_API_KEY` | MCP 鉴权 key，逗号分隔可配多个 |
| `LARK_APP_ID` / `LARK_APP_SECRET` / `LARK_REDIRECT_URI` | 可选，飞书扫码登录；未配置时登录页不显示飞书入口 |
| `SEED_ADMIN_PASSWORD` | 可选，覆盖种子 admin 密码（默认 admin123） |

## MCP 接入

端点：`http://localhost:3000/mcp`（Streamable HTTP），鉴权头 `Authorization: Bearer <MCP_API_KEY>`。

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

工具示例：`spms_list_issues {"type":"bug"}`（缺陷列表）、`spms_create_issue`、`spms_update_issue`、`spms_list_requirements`、`spms_create_requirement`、`spms_move_issue_to_sprint` 等，完整清单见 [docs/MCP.md](docs/MCP.md)。

## 技术栈

Next.js 16（App Router）· TypeScript · Tailwind v4 · React Query · Drizzle ORM（PostgreSQL）· @modelcontextprotocol/sdk · jose · bcryptjs

## 文档

- [docs/PLAN.md](docs/PLAN.md) — 项目规划与实施阶段
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 架构设计（分层 / 认证 / 指派传播 / 进度派生）
- [docs/DATA-MODEL.md](docs/DATA-MODEL.md) — 数据模型（18 表 + 枚举 + 级联）
- [docs/API.md](docs/API.md) — REST API 清单
- [docs/MCP.md](docs/MCP.md) — MCP 服务与 tools

## 常用命令

```bash
npm run dev           # 开发
npm run build         # 构建
npm run db:generate   # 生成迁移
npm run db:migrate    # 应用迁移
npm run db:seed       # 种子数据（幂等）
```
