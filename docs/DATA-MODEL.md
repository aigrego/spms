# next-spms 数据模型

PostgreSQL + Drizzle ORM。schema 源文件：`src/db/schema.ts`。
相对原 spms-server 的变更：**去掉所有 tenantId**（无多租户）；新增 `users`、`counters`；`members.portalUserId`→`userId`，删 `homeTenantId`。

二期「多公司沙箱」变更：新增 `companies`、`company_memberships`、`role_permissions`、`mcp_api_keys` 4 张表；
**全部业务表加 `companyId` NN（→ companies cascade）**，原 `key` 类唯一约束改为 `(companyId, key)` 复合唯一；
`counters` 主键改为 `(companyId, name)` —— 编号按公司独立。共 22 张表 + 21 个枚举。

## 枚举

| 枚举 | 取值 |
|---|---|
| member_type | `human \| agent` |
| member_origin | `internal \| external`（external=邮箱挂名外部资源，不能登录） |
| member_status | `active \| invited \| revoked` |
| issue_status | `backlog \| todo \| in_progress \| in_review \| done \| canceled` |
| issue_priority | `urgent \| high \| medium \| low \| none`（紧急度） |
| issue_importance | `critical \| high \| medium \| low \| none`（重要度，与 priority 正交） |
| issue_type | `backlog \| ticket \| bug`（备忘/工单/缺陷；缺陷是 Issue 的一种 type） |
| project_status | `backlog \| planned \| in_progress \| completed` |
| lifecycle_phase | `concept \| development \| release \| maintenance \| retired`（挂在 release 上） |
| product_status | `active \| maintenance \| archived` |
| release_status | `planned \| in_progress \| released \| deprecated` |
| requirement_type | `functional \| non_functional` |
| requirement_category | `performance \| security \| usability \| reliability \| compatibility \| maintainability`（仅 NFR） |
| requirement_status | `draft \| reviewing \| approved \| in_dev \| shipped \| rejected` |
| sprint_status | `planned \| active \| completed` |
| test_case_status | `draft \| active \| deprecated` |
| test_result | `untested \| passed \| failed \| blocked` |
| activity_kind | `created \| status \| assign \| comment \| ai` |
| assignment_node | `product \| release \| project \| sprint`（不含 product_line） |
| assignment_role | `lead \| member`；assignment_source | `direct \| propagated` |

## 表

> **多公司沙箱约定**：以下业务表均带 `companyId` NN → companies cascade（users 除外——账号跨公司）；
> 表中 `key`/`email`/`userId`/`agentKey` 等原全局唯一约束一律改为 **(companyId, …) 复合唯一**（如 members `(companyId, email)`、issues `(companyId, key)`），下表不再逐一标注 companyId。

### users（登录账号）
`id` PK · `username` unique NN · `passwordHash` NN · `name` NN · `role` NN 默认 `member`（admin=平台管理员 | member=普通用户，**平台级角色**）· `larkUnionId` unique · `createdAt` NN

### companies（新增，公司沙箱）
`id` PK · `key` unique NN（如 `DEFAULT`/`SAMPLE`）· `name` NN · `color` · `description` · `createdAt` NN

### company_memberships（新增，用户↔公司 + 公司内角色）
`id` PK · `userId` NN → users cascade · `companyId` NN → companies cascade · `role` NN（`company_admin | product_manager | developer | tester | viewer`）· `createdAt` NN · 唯一 `(userId, companyId)`

### role_permissions（新增，角色×模块权限矩阵，全局参考数据不按公司分）
复合 PK `(role, module)` · `role` NN（4 个可配置角色：product_manager/developer/tester/viewer）· `module` NN（10 个模块：issues/products/requirements/testcases/projects/resources/roadmap/backlog/sprints/agents）· `level` NN（`none | read | write`）
—— `company_admin` 与平台管理员恒全权限，不入此表；缺失行按 `none` 处理。

### mcp_api_keys（新增，MCP 接入密钥）
`id` PK · `keyHash` unique NN（sha256 hex，不存明文）· `prefix` NN（前 8 位，仅展示）· `name` NN · `companyId` → companies cascade（**NULL = 平台级 key**，否则公司级）· `createdBy` → users set null · `ownerId` → users set null（**所属人**：MCP 调用的第一人称身份，默认=创建人，可改）· `revokedAt`（吊销标记，行保留审计）· `createdAt` NN

### counters（编号序列，二期改为按公司独立）
复合 PK `(companyId, name)` · `companyId` NN → companies cascade · `name` NN · `value` int NN 默认 0 —— `INSERT ... ON CONFLICT DO UPDATE SET value = counters.value + 1 RETURNING value`；同一前缀（如 BUG）在不同公司各自从 1 起编。

### members（人 + AI agent 同表）
`id` PK · `type` NN 默认 human · `name` NN · `initials` NN · `color` · `role` · `userId` unique（→ users.id）· `agentKey` unique（atlas|forge|sentry|scribe）· `origin` NN 默认 internal · `email` unique · `status` NN 默认 active

### teams（遗留概念，UI 已隐藏）
`id` PK · `key` unique NN · `name` NN · `color` NN

### labels
`id` PK · `key` unique NN · `name` NN · `color` NN

### product_lines（生命周期顶层）
`id` PK · `key` unique NN（PL-N）· `name` NN · `description` · `color` NN 默认 `#0063D3` · `position` int NN 默认 0

### products
`id` PK · `productLineId` NN → product_lines cascade · `key` unique NN（PD-N）· `name` NN · `description` · `icon` NN 默认 box · `color` NN · `status` NN 默认 active · `leadId` → members · `position` NN 默认 0

### releases（版本，PLC phase 挂在这里）
`id` PK · `productId` NN → products cascade · `key` unique NN（RL-N）· `name` NN · `description` · `status` NN 默认 planned · `phase` NN 默认 concept · `targetDate` · `progress` real NN 默认 0（存储列被派生覆盖）· `position` NN 默认 0

### projects
`id` PK · `name` NN · `teamId` → teams · `releaseId` → releases cascade（可空）· `status` NN 默认 backlog · `leadId` / `aiLeadId` → members · `icon` NN · `color` NN · `target`（如 "Q3"）· `progress` real NN 默认 0（派生覆盖）· `description` · `summary` / `goal` / `nonGoals`（PRD 三段）

### sprints（恰好属于一个 project）
`id` PK · `teamId` → teams（兼容保留）· `projectId` → projects cascade · `name` NN · `goal` · `status` NN 默认 planned · `startDate` / `endDate` timestamptz NN · `capacity` int · `createdAt` NN

### sprint_snapshots（燃尽快照）
`id` PK · `sprintId` NN → sprints cascade · `day` timestamptz NN · `remainingPoints` int NN

### requirements（需求/PRD）
`id` PK · `key` unique NN（FR-N / NFR-N，创建后固定）· `projectId` NN → projects cascade · `releaseId` → releases set null · `title` NN · `type` NN 默认 functional · `category`（仅 NFR）· `priority` NN 默认 none · `importance` NN 默认 none · `status` NN 默认 draft · `description`（PRD 正文）· `acceptanceCriteria` · `authorId` / `aiOwnerId` → members · `position` NN 默认 0 · `createdAt` / `updatedAt` NN

### issues（核心工作项；缺陷 = type='bug'）
`id` PK（内部，不出网）· `key` unique NN（BLG/TKT/BUG-N）· `teamId` → teams · `title` NN · `description` · `type` NN 默认 ticket · `status` NN 默认 todo · `priority` / `importance` NN 默认 none · `assigneeId` → members · `projectId` → projects set null · `requirementId` → requirements set null · `sprintId` → sprints set null · `estimate` int · `storyPoints` int · `backlogRank` int NN 默认 0 · `aiAssigned` bool NN 默认 false · `commentsCount` int NN 默认 0 · `createdAt` / `updatedAt` NN

### issue_labels（多对多）
`issueId` / `labelId` 复合 PK，均 cascade

### sub_issues（issue 内 checklist）
`id` PK · `issueId` NN → issues cascade · `title` NN · `status` NN 默认 todo · `position` NN 默认 0

### activities（issue 动态/评论流）
`id` PK · `issueId` NN → issues cascade · `whoId` → members · `kind` NN 默认 comment · `body` NN · `createdAt` NN

### test_cases
`id` PK · `key` unique NN（TC-N）· `projectId` NN → projects cascade · `requirementId` → requirements set null · `title` NN · `priority` NN 默认 none · `status` NN 默认 draft · `result` NN 默认 untested · `preconditions` / `steps` / `expected` · `authorId` / `assigneeId` → members set null · `position` NN 默认 0 · `createdAt` / `updatedAt` NN

### resource_assignments（虚拟团队，多态无外键，应用层保证引用完整性）
`id` PK · `nodeType` NN（product|release|project|sprint）· `nodeId` NN · `memberId` NN → members cascade · `role` NN 默认 member · `source` NN 默认 direct · `addedById` → members set null · `createdAt` NN · 唯一 `(nodeType, nodeId, memberId)`

## 关系与级联

```
product_line ─cascade→ product ─cascade→ release ─cascade→ project ─cascade→ sprint
                                                          │─cascade→ requirement
                                                          │─cascade→ test_case
                                                          └─set null→ issue.projectId
requirement ─set null→ issue.requirementId / test_case.requirementId
sprint ─set null→ issue.sprintId
member ─cascade→ assignments；─set null→ author/assignee/lead 引用
```

- 删 project：requirements/sprints/test_cases 级联删，**issues 只 set null**
- 删成员：assignments 级联删，其余引用 set null
- 删公司：公司内全部业务数据、counters、memberships、公司级 mcp_api_keys 级联删（沙箱整体清除）
