# next-spms 数据模型

PostgreSQL + Drizzle ORM。schema 源文件：`src/db/schema.ts`。
相对原 spms-server 的变更：**去掉所有 tenantId**（无多租户）；新增 `users`、`counters`；`members.portalUserId`→`userId`，删 `homeTenantId`。

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

### users（新增，登录账号）
`id` PK · `username` unique NN · `passwordHash` NN · `name` NN · `role` NN 默认 `member`（admin|member）· `larkUnionId` unique · `createdAt` NN

### counters（新增，编号序列）
`name` PK · `value` int NN 默认 0 —— `INSERT ... ON CONFLICT DO UPDATE SET value = counters.value + 1 RETURNING value`

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
