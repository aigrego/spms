# ATTACHMENT-REKEY · SPMS · 附件存储重键与全实体化(MinIO 唯一后端 · 共享 bucket + `{companyId}/*` IAM 隔离 · `{companyId}/{category}/{userId}/{fileType}/*` 四级 key · 附件泛化到 issues/cases/requirements · 历史对象只拷不删迁移)

> 站在既有存储层(`src/server/storage/{types,index,minio,provision}.ts`)、附件服务(`src/server/services/attachments.ts`)、对账脚本(`scripts/reconcile-attachments.ts`)之上。
> 本期交付:**① 对象 key 新规则 `{companyId}/{issues|cases|requirements}/{userId|system}/{fileType}/{uuid}-{safeName}`,公司 ID 提为第一段,IAM 隔离边界随之改为 `{companyId}/*`;② 附件能力从仅 issue 泛化到 test cases 与 requirements(表、服务、REST、UI、MCP 上传);③ 一次性迁移脚本把三个时代的历史附件(平台级 Vercel Blob、公司自配后端、旧前缀 MinIO)全部拷贝到新规则位置并清洗 DB 地址,旧对象一律不删,由用户事后手动清理。**
> 本期的独特职责:只动「对象放哪、叫什么、谁能碰」与「附件能挂在哪」——不改任何业务状态机与权限模型(复用既有 `issues`/`testcases`/`requirements` 三个 permission module)。
> **本期不删除任何旧对象、不自动删除任何 DB 行;Vercel Blob 死链行只报告不处置。**

## 0. 本期范围与决策

一句话定性:难点不在「把文件从 A 拷到 B」,而在 ① key 规则换了**段序**(公司 ID 提前)导致 IAM 策略、`assertMeta`、读取代理、对账脚本四处断言要同步换;② 过渡期新旧两种 key 同时存活,隔离断言必须双格式兼容且新写入只产新格式;③ 三类历史对象的取回通道各不相同(公网 fetch / 同 bucket 拷贝 / 旧凭据下载),而旧凭据会被 force 重开通**覆盖**,顺序错了就永远取不回。

| # | 决策点 | 选择 | 含义 |
| --- | --- | --- | --- |
| 1 | 形态 | 纯仓内增量 + 两个一次性脚本(`scripts/reprovision-policies.ts`、`scripts/migrate-attachments.ts`);无新部署件、无新 env | Next.js 应用与 MinIO 拓扑不变;脚本走 tsx,env 加载照抄 `scripts/reconcile-attachments.ts:27-36` |
| 2 | key 新规则 | `{companyId}/{issues\|cases\|requirements}/{userSegment}/{fileType}/{uuid}-{safeName}`;`safeName` 沿用现 sanitizer(`types.ts:54`) | `objectKeyPrefix/newObjectKey/companyIdFromKey/assertOwnKey` 四个函数全部改写(`types.ts:43-62`);`minio.ts:130` assertMeta 硬编码前缀同步改;uuid 保证唯一不依赖随机后缀 |
| 3 | IAM 隔离边界 | canned policy 资源从 `<bucket>/issues/{companyId}/*` 改为 `<bucket>/{companyId}/*`;**过渡期策略同时放行新旧两前缀**,用户手动删完旧对象后 `--tighten` 收紧 | `provision.ts:33-57 companyPolicyDocument` 加 `includeLegacy` 参数;已开通公司必须跑 repolicy 脚本重发策略,否则新 key 写不进、旧 key 读不了的风险窗口见 §0.2-b |
| 4 | 附件表结构 | `issue_attachments` **改名** `attachments`,加 `testCaseId`/`requirementId` 可空 FK(cascade),`issueId` 降为可空,CHECK 三 FK 恰一非空 | drizzle-kit 对改名会生成 drop+create,**迁移 SQL 手工改写为 `ALTER TABLE … RENAME` + `ADD COLUMN`**;全仓 `issueAttachments` 引用清扫(services/mcp/scripts/serialize) |
| 5 | fileType 推导 | 从 **contentType(MIME)** 映射:`image/*`→`images`;`ALLOWED_DOC_TYPES`(`src/lib/attachments.ts:9-20`)→`documents`;其余/空→`others`;不做魔数嗅探 | 映射函数 `fileTypeOf()` 放 `src/lib/attachments.ts`(client/server/script 三处共用);新上传的 contentType 已过 allow-list 校验,实际只落 images/documents;others 只为历史行兜底 |
| 6 | userSegment | 新上传 = `actor.memberId`(服务端取,客户端不能指定);`uploadedById IS NULL` 的历史行与 **Notion 同步**来源 = `system` | MCP/REST 上传的 memberId 恒非空(已核实 `src/mcp/server.ts:68-112` 构造的 actor 必有 memberId);`system` 为保留字,member id 是 uuid 不会撞 |
| 7 | 迁移目标 | 一律迁入**平台共享 bucket 的本公司 auto 账号前缀**;`provisioned IS NULL` 的手动配置行公司:先备份配置,再 force 重开通转成 auto,再迁移 | force 重开通会**覆盖** `company_storage_configs` 行、旧凭据即丢(已核实 `provision.ts:68-69,146-150`)——所以备份是迁移的硬前置(§4-P3) |
| 8 | 旧对象处置 | 只拷不删(用户规则);迁移脚本无删除分支;给用户一份手动删除的 mc 命令清单(§7.3) | bucket 内短期双份数据;旧前缀对象对更新后的对账脚本不可见(见 §0.2-d),不会误报 |
| 9 | 实体泛化范围 | REST + UI + MCP 上传工具(新增 `spms_upload_test_case_attachment`、`spms_upload_requirement_attachment`);权限复用 `'testcases'`/`'requirements'` module(已核实存在,`src/lib/permissions.ts:22-23`) | **MCP 读取侧图片内联不做**(`spms_get_issue` 的 :404-433 模式不搬到 get_requirement/get_test_case),二期;permission module 注册零改动 |
| 10 | 粘贴图 | 评论粘贴图维持不注册为附件行(现状,`IssueDetail.tsx:177-205`),intent 时 category 默认 `issues` | 既有坑「对账会误删未注册粘贴图」不改根,本期给对账脚本加 `--min-age-days` 护栏并文档化(§10) |

### 0.1 职责边界:谁拥有什么

|  | MinIO(IAM/bucket) | 应用存储层(`src/server/storage/`) | 迁移/策略脚本(`scripts/`) | 运维(用户) |
| --- | --- | --- | --- | --- |
| 拥有 | 私有 bucket、公司 IAM 用户与 canned policy 的**服务端强制**隔离 | key 生成与断言、presign、代理读取、canonical url | 历史对象取回与拷入、DB 行地址清洗、策略重发 | force 重开通手动行公司、删旧对象、删确认的死链行 |
| 红线 | — | **绝不允许客户端指定 key 的任何一段**;不感知历史时代 | **绝不删源对象、绝不删 DB 行**;不把解密后的密钥写日志 | 删旧对象前必须先看到迁移全绿报告 |

一句话:MinIO 管「公司之间谁也碰不到谁」,存储层管「key 长什么样、是不是我的」,脚本管「把历史搬过来、把 DB 指过来」,删除权只留在人手里。

### 0.2 关键取舍(显式记录而非默默处理)

- **a. 段序调换(公司在最前)而非兼容保留旧序。** 用户拍板的规则;好处是 IAM 策略一段前缀即覆盖公司全部对象,cases/requirements 天然入隔离域。代价:`issues/{companyId}/` 旧前缀下全部存量对象都要动;`assertOwnKey`/`companyIdFromKey` 在过渡期必须双格式。缓解:双格式只读不写(新写入只产新格式),tighten 后留注释标记 legacy 分支可删。
- **b. IAM 策略过渡期双前缀放行。** 若直接换成 `{companyId}/*`,旧 key(`issues/{companyId}/…`)立刻读不了,迁移窗口内存量附件全 404。代价:隔离粒度在窗口期比目标态略宽(同公司旧前缀仍可读写——但旧前缀本就只属于该公司,不引入跨公司面)。缓解:repolicy 脚本默认写双前缀策略,`--tighten` 在旧对象手动删除后重跑收紧;脚本每步回读策略内容校验。
- **c. 改名表 + 三 FK 单选,而不是新建三张表或多态 entityType 列。** 三张表 = 服务/REST/UI/MCP 全套×3;多态列丢 FK cascade(删 issue 不再级联清行)。代价:`attachments` 三个 FK 列两列恒空,CHECK 约束包住脏写;改名迁移 SQL 需手工改写并在数据副本上试跑。缓解:drizzle CHECK + 服务层写入点单处(`registerAttachment`);迁移脚本与对账脚本都不再 join issues,按三 FK 分列统计。
- **d. 迁移幂等按「key 格式」判定。** 已迁移行(objectKey 命中新格式 `^{companyId}/`)直接跳过,脚本可反复跑。代价:若某行被人工改成新格式但对象没拷,会被误判跳过。缓解:apply 结束前全量校验「每行新 key 在新后端 statObject 可达」,不可达的行单独列出;对账脚本更新后只 list 新前缀 `{companyId}/`(旧前缀对象天然不可见,不误报孤儿,也不替用户删旧对象)。
- **e. Notion 历史行落不到 `system/`。** DB 里 Notion 同步进来的行 `uploadedById` 是**点击同步的用户**(已核实 `notionSync.ts:295` 复用 `registerAttachment`,actor 来自 `sync/route.ts:15` requireActor),与手工上传无法区分。选择:迁移时 userSegment 一律取 `uploadedById ?? 'system'`;**从本期起** Notion 同步新产生的附件 key 固定写 `system` 段(DB 的 `uploadedById` 仍记录操作人,作审计)。代价:历史 Notion 附件落在个人目录下,与「Notion 归 system/」的规则有偏差。缓解:规则本身的语义(隔离 + 可归类)不受损;偏差在 §9 开放问题中显式列出。
- **f. fileType 用 MIME 而非魔数嗅探。** 迁移源里 Vercel fetch 的响应 content-type 未必可信,但 DB 行本身的 `contentType` 字段是注册时校验过的,直接用它。代价:历史行 contentType 若脏(如 `application/octet-stream`)会落 `others/`。缓解:dry-run 报表列出将落 `others/` 的行数与样本,人工过目后再 apply。
- **g. 读取代理/后端的 legacy 兼容只在读删两条路径。** `get/getReadUrl/del` 的 `assertOwnKey` 接受 `{companyId}/` 与 `issues/{companyId}/` 双前缀;`put/createUploadIntent/assertMeta` 只认新格式。代价:兼容代码要留到用户删完旧对象并 tighten 之后。缓解:legacy 分支统一注释 `LEGACY-KEY:` 标记,收尾清单(§8-M5)含「确认零 legacy 行后删除双格式分支」。

### 0.3 明确不在本期

- **MCP 读取侧图片内联扩展到 `spms_get_requirement` / `spms_list_test_cases`**——二期,照 `src/mcp/server.ts:404-433` 范式搬即可。
- **评论粘贴图注册为附件行**(对账误删坑的根修)——另立项;本期只对账加 `--min-age-days` 护栏 + 文档警告。
- **旧对象自动删除**——用户明确手动删;§7.3 给出 mc 命令清单,tighten 后运维执行。
- **Vercel Blob 死链行的自动处置**——fetch 失败的行只进迁移报告,DB 行保留(代理仍 302 存量 url),删行由人确认后手动 SQL。
- **plans/sprints/products 等其他实体的附件**——无需求,表结构已泛化,未来加实体 = 加一列 FK + 一个 category 枚举值。
- **公司级手动配置后端的继续支持**——目标模型收敛为共享 bucket;存量手动行公司按 §4-P3 流程转 auto,保留手动配置能力的 UI/路由不动(平台管理员仍可改行),只是迁移脚本不以手动行为目标。

## 1. 拓扑与改动面

**`src/server/storage/` —— key 规则源头,全部修改:**

- `types.ts:43-62`:`objectKeyPrefix(companyId)` 改为 `` `${companyId}/` ``;`newObjectKey(companyId, category, userSegment, fileType, filename)`;`companyIdFromKey` 双格式解析(新格式取第一段,legacy `issues/{cid}/` 取第二段,均返回 companyId);`assertOwnKey` 双前缀接受(legacy 分支标 `LEGACY-KEY:`);新增 `categoryFromKey(objectKey)`(新格式第二段,供 assertMeta 比对)。新增类型 `AttachmentCategory = 'issues' | 'cases' | 'requirements'`。
- `minio.ts:98-102`:`createUploadIntent(filename, {category, userSegment, contentType})` 签名扩展,内部 `fileTypeOf(contentType)`;`assertMeta(url, objectKey, expected: {category, userSegment})` 增比对「key 的 category 段 === expected.category 且 userSegment 段 === expected.userSegment」;put 路径只认新格式(assertOwnKey 的新前缀分支)。
- `provision.ts:33-57`:`companyPolicyDocument(bucket, companyId, opts?: {includeLegacy?: boolean})`,Resource/Condition 前缀切换;文件头注释(:15-25)同步改写。
- `index.ts`:仅注释与 re-export 更新(:10),逻辑零改动。

**`src/lib/attachments.ts`**:`fileTypeOf(contentType): 'images'|'documents'|'others'` 新增;文件头注释(:4)的前缀说明更新。

**`src/db/schema.ts`**:`issueAttachments`(:634-657)→ `attachments`(改名 + `testCaseId`/`requirementId` + CHECK + 三 FK 索引);`testCases`(:710)/`requirements`(:506) 的 relations 补 `attachments`;`pnpm db:generate` 后**手工改写迁移 SQL**(§2)。

**服务端:**

- `src/server/services/attachments.ts` 重构:`registerAttachment(actor, entity: {type, key}, meta)` 泛化(entity→permission module/category/FK 列一张内部映射表);`listAttachments` 同参泛化(现状是死代码,泛化后给 detail 查询复用或删除——实现时二选一,优先复用);`deleteAttachment` 按行实际 FK 分支 requirePerm。
- 新路由 ★:`src/app/api/v1/pms/test-cases/[key]/attachments/route.ts`、`src/app/api/v1/pms/requirements/[key]/attachments/route.ts`(均 POST,照 `issues/[key]/attachments/route.ts:9-12` 薄适配)。
- `src/app/api/v1/pms/attachments/upload/route.ts:21-36`:入参加 `category`(默认 `'issues'`),调 `createUploadIntent` 时传 `userSegment: actor.memberId`;仍无 requirePerm(沿用现状,真正闸门在注册时)。
- `src/app/api/v1/pms/attachments/[id]/route.ts`:零改动(服务层内分支)。
- `src/app/api/v1/pms/attachments/object/route.ts`:逻辑零改动(`companyIdFromKey` 双格式后 :39 的 `?key=` 鉴权自动兼容);注释更新。
- `src/app/api/v1/pms/storage-config/route.ts:63,98` 与 `platform/companies/[id]/storage/route.ts:46`:回显的 prefix 值随 `objectKeyPrefix` 自动变为 `{companyId}/`,确认 UI 文案不受误导。
- `src/mcp/server.ts`:`spms_upload_issue_attachment`(:811-854)的 :844 改新签名(category `'issues'`、userSegment `actor.memberId`);新增两个上传工具(照抄该段);`docs/MCP.md:82` 同步。
- `src/server/services/notionSync.ts:293`:`newObjectKey` 传 userSegment `'system'`;文件其余零改动。

**前端:**

- `src/lib/upload.ts:26-68`:`createIntent`/`uploadAttachment` 加 `category` 参数透传。
- `src/lib/api.ts`:`:65-71 AttachmentMeta` 不变;`:314-317` 两个函数不动;新增 `registerTestCaseAttachment`/`registerRequirementAttachment`(POST 到对应新路由);`:419-425`/`:405-412` 的 detail 返回类型随 serialize 扩展。
- `src/lib/serialize.ts`:`serializeAttachment`(:228-251)零改动;`serializeTestCase`(:123)/`serializeRequirement`(:75)的 detail 变体嵌入 `attachments`(照 `serializeIssueDetail` :271-274)。
- `src/lib/types.ts:339,353`:`IssueAttachment` 不变;`TestCase`/`Requirement` detail 类型加 `attachments`。
- `src/store/testcases.ts`、`src/store/requirements.ts`:注册/删除附件 mutation hooks(照 `src/store/issues.ts:93-108`)。
- `src/components/AttachmentSection.tsx` ★:从 `IssueDetail.tsx:628-710`(附件区块)+ `:405-413`(上传)+ `:435-437`(删除)抽出共享组件;`IssueDetail.tsx` 改用它;`TestCasesView.tsx`、`RequirementsView.tsx` 接入(两者当前无任何附件代码,已核实)。

**脚本:**

- `scripts/reprovision-policies.ts` ★:对全部 `provisioned='auto'` 公司重发 canned policy(默认双前缀,`--tighten` 收紧为仅新前缀);逐公司回读校验;不动 secret、不动 DB 行。
- `scripts/migrate-attachments.ts` ★:§4-P3 管线。
- `scripts/reconcile-attachments.ts`:`listObjects` 前缀 :71 改 `{companyId}/`;SQL :88-91 去 issues join 改查 `attachments` 三 FK;`--min-age-days`(默认 7)护栏 + 未注册粘贴图警告注释。
- `scripts/delete-notion-issues-by-status.ts:131-134`:级联删行假设不变,注释里的表名更新。

**文档:** `docs/ARCHITECTURE.md:211-247`(key 规则/IAM 前缀/对账节重写)、`docs/DATA-MODEL.md:108-118`(attachments 表 + 配置表)、`docs/MCP.md:61,82`、`docs/API.md`(附件路由整体补文档——现状完全没有,已核实)、`README.md:20`。

**端口/env/新增件核对:** 无新端口;无新 env(脚本沿用 `DATABASE_URL`、`.env` 里的 `CONFIG_CRYPTO_KEY`,`.env.example:2,13`);两个新脚本走 `npx tsx`,不注册进 package.json scripts(一次性工具,与 reconcile 现状一致)。

## 2. 数据模型

| 表 | 关键列 | 说明(语义 + 约束/索引) |
| --- | --- | --- |
| `attachments`(由 `issue_attachments` 改名) | `id` text pk、`companyId` FK cascade notNull、`issueId` FK→issues cascade **可空**、`testCaseId` FK→test_cases cascade 可空 ★、`requirementId` FK→requirements cascade 可空 ★、`url`、`pathname`(= object key)、`objectKey`(新规则全规则 key;迁移完成前可能仍是旧格式或 NULL)、`filename`、`contentType`、`size`、`uploadedById` FK→members set null、`createdAt` | CHECK `num_nonnulls(issue_id, test_case_id, requirement_id) = 1`;索引 `attachments_issue_idx`(沿用改名)、★`attachments_test_case_idx`、`attachments_requirement_idx` |

迁移 SQL(`pnpm db:generate` 生成后**手工改写**,drizzle-kit 不会生成 rename):

```sql
ALTER TABLE issue_attachments RENAME TO attachments;
ALTER TABLE attachments ALTER COLUMN issue_id DROP NOT NULL;
ALTER TABLE attachments ADD COLUMN test_case_id text REFERENCES test_cases(id) ON DELETE CASCADE;
ALTER TABLE attachments ADD COLUMN requirement_id text REFERENCES requirements(id) ON DELETE CASCADE;
ALTER TABLE attachments ADD CONSTRAINT attachments_one_owner_chk
  CHECK (num_nonnulls(issue_id, test_case_id, requirement_id) = 1);
-- 索引改名/新增从略,按 drizzle 快照风格命名
```

约定:软引用风格不变(url 是身份标识不是可读地址);三 FK 的 entity→category 映射 = `issueId→issues`、`testCaseId→cases`、`requirementId→requirements`,服务层一张常量表单点维护;`objectKey` NULL 行的语义从「Vercel 旧行」变为「迁移失败/未迁移的 Vercel 旧行」,迁移后应清零(不清零 = 报告里的失败行)。

## 3. 集成与契约

- drizzle 迁移工具链:**已核实(`package.json:10-11` `db:generate`/`db:migrate`、`drizzle.config.ts:14-21`)**,零改动;迁移 SQL 手工改写先在数据副本上试跑(§7.3)。
- permission modules:**已核实(`src/lib/permissions.ts:22-23`)`'requirements'`/`'testcases'` 已注册**,零改动;不加新 module。
- `companyIdFromKey` 唯一消费点是读代理 `object/route.ts:39`:**已核实**,语义扩展后该处零改动。
- MinIO IAM:`mc admin policy create` 对同名策略的覆盖语义**需在 repolicy 脚本里按 create-or-replace 防御处理并回读校验**(不臆断覆盖行为);`withMcAdmin` 封装已核实(`src/server/storage/mc.ts`,provision.ts:99 在用)。
- minio-js 受限凭据 region:已核实 `index.ts:96`/`provision.ts:118-121` 的 pin us-east-1 语义——**两个新脚本用公司受限凭据建 client 时必须同样 pin `region:'us-east-1'`**,否则 getBucketRegion 探活被拒导致长重试(已知坑 §10)。
- serialize/api/store 各上游:精确增量见 §1 前端清单;`serializeAttachment` 输出形状不变,前端展示零回归。
- seed/配置清单(实现期照单执行):① `pnpm db:generate` + 手工改写 + `db:migrate`;② 跑 `reprovision-policies.ts`(双前缀);③ 运维确认手动行公司清单 → 备份 → force 重开通;④ `migrate-attachments.ts` dry-run → apply;⑤ 用户删旧对象 → `reprovision-policies.ts --tighten`;⑥ 文档五处。

## 4. 服务端机制(核心业务)

**P1 新上传管线(REST 浏览器直传):**

1. `POST /attachments/upload {filename, contentType, size, category?}`(route 层 requireActor):校验 allow-list 与 10MB(现状 :28-31 保留)→ `storageForCompany` → `createUploadIntent(filename, {category: 入参或 'issues', userSegment: actor.memberId, contentType})` → 服务端铸 key `{companyId}/{category}/{memberId}/{fileType}/{uuid}-{safeName}` → presigned PUT。
2. 浏览器 PUT 直传(现状不变)。
3. `POST /{issues|test-cases|requirements}/:key/attachments`(route 层 requireActor → service):闸门**顺序** = requirePerm(对应 module write)→ 实体存在(对应 `*_NOT_FOUND`,沿用各 service 既有错误码与信封语义,不断言 HTTP status)→ meta 非空 → `assertMeta(url, key, {category: 该实体 category, userSegment: actor.memberId})`(VALIDATION_FAILED:前缀/category/userSegment 任一不符)→ contentType allow-list → size → 插入 `attachments`(对应 FK 列)。
4. MCP 上传工具同管线,区别仅在 actor 构造与 `put` 直传(server.ts:832-852 现状保留,key 铸法换新签名)。
5. Notion 同步:`newObjectKey(companyId, 'issues', 'system', fileTypeOf(ct), name)` → `put` → `registerAttachment`(entity issue;DB `uploadedById` 仍记同步操作人)。

**P2 策略重发管线(`reprovision-policies.ts`):** 读 `platform_storage_configs` 得 admin 凭据 → 逐 `provisioned='auto'` 公司 `withMcAdmin` 写 policy 文件(`companyPolicyDocument(bucket, cid, {includeLegacy: !tighten})`)→ `admin policy create`(已存在则先 `admin policy remove` 再 create,两种路径都回读 `admin policy info` 校验 JSON 逐字节一致)→ 报表(成功/失败逐公司)。不触碰 user/secret/DB。

**P3 迁移管线(`migrate-attachments.ts`,默认 dry-run):**

1. env 加载照抄 reconcile:27-36;`--backup-configs` 把 `company_storage_configs` 全行(密文原样)快照到 `data/migration-backups/<ts>.json`——**任何 force 重开通之前必须先跑这步**。
2. 分类:全量 `attachments` 行 LEFT JOIN 公司配置 → 四类:`NEW_FMT`(objectKey 匹配 `^{companyId}/`,跳过)/`LEGACY_SHARED`(objectKey 匹配 `^issues/{companyId}/` 且公司行为 auto → 同 bucket `copyObject`)/`LEGACY_MANUAL`(objectKey 非空但公司行是手动配置 → 用 `--backup-configs` 快照里的旧凭据建源 client `getObject`)/`VERCEL`(objectKey IS NULL → `fetch(行.url)`,公网地址)。
3. dry-run 输出:逐公司逐类计数、将落 `others/` 的行样本、`--probe` 时对 VERCEL 行做 HEAD、对 MinIO 源做 statObject,不可达的计入「预计失败」。
4. apply 逐行:取回字节(或 copyObject)→ 新 key = `{companyId}/{entity 对应 category}/{uploadedById ?? 'system'}/{fileTypeOf(contentType)}/{new uuid}-{safeName(filename)}` → 用该公司 auto 受限凭据(pin region)put → `UPDATE attachments SET url = canonicalUrl(newKey), pathname = newKey, object_key = newKey WHERE id = …`(canonicalUrl 逻辑直接 import `minioBackend` 复用,与 reconcile import `decryptSecret` 同模式)→ 单行失败记录继续跑,**绝不动源对象**。
5. 收尾校验:重新扫全表,凡 objectKey 不命中新格式的行逐条列出(= 失败清单,退出码非零);并对全部新 key statObject 抽验。
6. 内容寻址说明:LEGACY_SHARED 用 copyObject 不落盘;VERCEL/LEGACY_MANUAL 经内存 Buffer(单文件 ≤10MB,与 `MAX_ATTACHMENT_SIZE` 一致,无流式需求)。

**对账脚本更新后语义:** list 前缀 `{companyId}/`;孤儿 = 对象在、行不在(含未注册粘贴图,`--min-age-days 7` 护栏 + 警告);死链 = 行在、对象不在;VERCEL 失败行维持「不对账」现状(文件头注释更新)。

## 5. 前端

- 抽 `AttachmentSection.tsx`:props = `{items, onUpload(file), onDelete(id), busy}`;含列表/预览/删除/隐藏 file input,accept 用 `ATTACHMENT_ACCEPT`;图片预览走 `objectReadUrl`(read proxy)不变。
- `IssueDetail.tsx` 换用共享组件(回归重点:上传/删除/预览/lightbox :1064-1105 不动);粘贴图流(:177-205)只改 `uploadAttachment` 调用加 `category: 'issues'`。
- `TestCasesView.tsx`:详情抽屉内加附件区块(requirements/testcases store hooks 取数与 mutation)。
- `RequirementsView.tsx`:需求详情同。
- `NewIssueModal.tsx:129,184`:草稿上传 → 注册流不变,category 传 `'issues'`。
- 空态(无附件不渲染列表)/错误态(上传失败 toast 沿用各视图既有模式)/10MB 与格式限制文案复用 `IssueDetail` 现文案。

## 6. 安全清单(验收断言的来源)

1. **公司隔离**:A 公司用户请求 `object?key={B公司新格式key}` → 拒绝(`companyIdFromKey !== actor.companyId`);legacy key 同理。
2. **IAM 前缀**:用 A 公司受限凭据直接 S3 操作 `{B公司}/…` → AccessDenied;双前缀窗口期内 A 公司凭据操作 `issues/{B公司}/…` 同样 AccessDenied。
3. **key 不可伪造**:注册时上报他人 userSegment 段或错 category 段的 key → `VALIDATION_FAILED`(assertMeta 三段比对)。
4. **凭据安全**:脚本不把解密后的 accessKey/secretKey 写日志;备份快照存密文原样。
5. **私有 bucket**:canonical url 不公开可读,代理 302 仍带 `Cache-Control: private, no-cache`(object/route.ts:47-49 不回归)。
6. **总开关**:`enabled=false` 时新旧读写全禁(STORAGE_DISABLED 路径,index.ts:122-124 不回归)。
7. **脚本零删除**:migrate/repolicy 两脚本源码无 `removeObject`/`DELETE FROM` 调用(repolicy 的 `admin policy remove` 仅针对 canned policy,不碰对象)。

## 7. 验证

### 7.1 自动化断言(脚本/SQL/mc,仓内无测试框架,不新建)

- 迁移 dry-run:输出四类计数与 `others/` 样本;与手工 SQL(`SELECT count(*) … GROUP BY` 分类同条件)对账一致。
- apply 后 SQL:`SELECT count(*) FROM attachments WHERE object_key IS NULL OR object_key NOT LIKE company_id || '/%'` → 0(失败行除外,与报告逐条对上)。
- 抽查:`mc stat alias/bucket/{新key}` 可达;`SELECT url` 与 canonicalUrl 规则逐字节一致。
- repolicy 后 `mc admin policy info alias spms-co-<cid8>` 输出与 `companyPolicyDocument()` 生成 JSON 一致;tighten 后 legacy 前缀消失。
- 隔离断言(真实环境 curl):跨公司 `object?key=` 期望拒绝;`enabled=false` 时期望 STORAGE_DISABLED。

### 7.2 跨模块回归

- `pnpm lint`、`pnpm build`、`tsc --noEmit` 全绿。
- issue 附件既有流(上传/列表/删除/预览/粘贴图/NewIssueModal 草稿附件)人工回归;Notion 同步一个含图页面,确认对象落在 `…/issues/system/images/…`。
- `reconcile-attachments.ts` dry-run 输出符合新语义;`--min-age-days` 护栏生效。

### 7.3 真实环境走查(顺序执行,上步不绿不进下步)

1. 迁移 SQL 在**数据副本**上 `db:migrate` → 全表行数不变、CHECK 生效(插一行三 FK 全空应被拒)。
2. 部署 M1-M3 代码前,先跑 `reprovision-policies.ts`(双前缀)→ 部署 → 新上传一个 issue 附件 → key 命中新规则、可读可删;**旧行**(旧 key)代理读取仍正常。
3. `--backup-configs` → 手动行公司 force 重开通 → dry-run(人工核对报表)→ apply → 收尾校验全绿。
4. 越权走查:§6-1/2/3 三条逐个人造请求验证。
5. 用户确认后:`mc rm --recursive --force alias/<bucket>/issues/`(旧前缀整体删除,含全部公司旧对象;**执行前确认 7.1 第二条 SQL 为 0**)→ `reprovision-policies.ts --tighten` → 再次隔离走查。

### 7.4 静态校验

`pnpm lint` + `pnpm build` + `tsc --noEmit`;grep 确认无残留 `issue_attachments`/`issues/${companyId}` 硬编码(legacy 兼容分支与注释除外)。

## 8. 里程碑(每步可验证)

| # | 里程碑 | 内容 | 验证 |
| --- | --- | --- | --- |
| M1 | key 规则与 IAM 重构 | types/minio/provision/upload route/MCP key 铸法/Notion system 段 + `reprovision-policies.ts` | lint+build 绿;双前缀策略重发回读一致;新上传落新 key;**旧 key 行代理读取不回归**(双格式分支) |
| M2 | 表泛化 + 服务/REST | schema 改名迁移(手工改写 SQL)+ attachments.ts 重构 + 两个新路由 + serialize/api/store 增量 | 副本库迁移行数不变、CHECK 生效;issue 附件 CRUD 回归;cases/requirements 注册/删除 200 |
| M3 | 前端 + MCP 工具 | AttachmentSection 抽取与三视图接入 + 两个 MCP 上传工具 | issue 详情零回归走查;case/requirement 各传一图一文档可见可删;MCP 工具上传后代理可读 |
| M4 | 迁移脚本 | backup → dry-run → apply + reconcile 更新 | dry-run 报表与 SQL 对账一致;apply 后 §7.1 两条 SQL 绿; reconcile dry-run 符合新语义 |
| M5 | 收尾 | 文档五处 + 全量回归 + §7.3 完整走查 + tighten 移交清单 | 全绿;向用户交付「手动删旧对象 + tighten + 死链行处置」三件事的命令清单 |

## 9. 风险与开放问题

- **最大风险:LEGACY_MANUAL/VERCEL 源取不回**(旧凭据已被覆盖、Vercel 对象已清理)。门:dry-run `--probe` 先量化「预计失败」清单给用户过目;失败行不阻塞其余,DB 行保留现状可继续 302。缓解:备份快照在任何 force 重开通之前跑。
- **次风险:改名迁移在真实库上的锁与耗时**。表行数小(附件表),`ALTER TABLE … RENAME` + 加可空列均为元数据级操作,风险低;仍坚持副本先试跑。
- **开放问题(实现前确认)**:① fileType 采用 MIME 三桶(images/documents/others),未做魔数嗅探——如需更细分类(videos/archives)改 `fileTypeOf` 一处即可,本期不做;② 历史 Notion 行落个人目录而非 system/(§0.2-e),如需严格可归,只能在迁移时按「存在 Notion 同步窗口期内的行」启发式归 system/,准确性无保障,默认不做;③ MCP 图片内联读取是否本期顺带做——默认不做(§0.3);④ memberId 直接进入 key(uuid,无 PII),若未来对 key 可读性有要求再设别名段。

## 10. 已知坑(沿用既有教训)

- **P0:评论粘贴图从未注册为附件行,对账 `--apply` 会把它们当孤儿删**(`IssueDetail.tsx:177-205` 未注册 vs `reconcile-attachments.ts:118-141` 按行比对)——既有缺陷,本期加 `--min-age-days` 护栏 + 警告,根修另立项(§0.3)。
- **受限凭据必须 pin `region: 'us-east-1'`**(`minio.ts:22-27`、`provision.ts:107-121`):受限用户无 GetBucketLocation,minio-js 探活被拒会长重试——两个新脚本建 client 时同样 pin。
- **force 重开通覆盖公司行、旧凭据即丢**(`provision.ts:146-150` `onConflictDoUpdate`)——备份先行。
- **公网基址签名 host 钉死**(`minio.ts:71-84`):canonicalUrl 与 uploadUrl 去 query 必须逐字节相等,迁移脚本写 url 时复用 `minioBackend().canonicalUrl`,不自拼。
- **drizzle-kit 不认识表改名**,默认生成 drop+create——迁移 SQL 必须手工改写为 `ALTER TABLE … RENAME` 并在副本上试跑。
- **Vercel 旧行无 SDK 可操作**(reconcile 文件头 :8-11):fetch 即全部手段,死链只报告不处置。

## 11. 需求 → 设计映射(自检)

| # | 需求 | 本期落点 |
| --- | --- | --- |
| R1 | key 前缀 `{companyId}/{issues\|cases\|requirements}/*` + 每公司 IAM 账号隔离 | §0-2/3、§1 storage 清单、§4-P1/P2;验证 §7.1 policy 回读 + §7.3-4 越权走查 |
| R2 | object_key 全规则 `{companyId}/{category}/{userId}/{fileType}/*` | §0-2、§4-P1 铸 key 步骤;验证 §7.3-2 新上传 key 断言 |
| R3 | cases/requirements 支持挂附件 + 表结构调整 | §0-4、§2、§4-P1-3、§5;验证 §7.3-1 迁移与 M2/M3 验收 |
| R4 | uploadedById NULL → `system/`;Notion → `system/` | §0-6、§4-P1-5、§4-P3-4;验证 §7.2 Notion 同步落点 |
| R5 | fileType 从文件格式(MIME)推导,未识别 → `others/` | §0-5 `fileTypeOf`;验证 dry-run `others/` 样本人工过目 |
| R6 | 存量 IAM 策略重新生成下发 | `reprovision-policies.ts`(§4-P2);验证 §7.1 policy 比对 |
| R7 | 旧对象只拷不删,用户事后手动删 | §0-8、§6-7、§7.3-5;验证 §6-7 静态断言 |
| R8 | Vercel Blob 历史附件按新规则迁入 MinIO + 清洗 DB 地址 | §4-P3(VERCEL 类 + UPDATE 行);验证 §7.1 apply 后 SQL |
| — | 硬约束:公司隔离/凭据 AES-GCM 不出库/私有 bucket 代理读 | §6-1/4/5;验证 §7.3-4 |
| — | **不在本期**:MCP 内联读取、粘贴图注册化、旧对象自动删、死链行自动处置 | §0.3 |
