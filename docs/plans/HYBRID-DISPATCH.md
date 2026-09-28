# HYBRID-DISPATCH · SPMS + agent_runner(Go) · 人机混合调度平台(SPMS 控制平面 + Gitea-runner 模式 + 员工 1:1 绑定 runner + ACP 驱动成熟 Agent 引擎 + 工作流化)

> v3(2026-09-24):执行平面 = 自研 Go agent_runner(act_runner 模式),**不自建 Agent 大脑**——runner 通过 ACP(主)/headless CLI(兜底)驱动成熟 coding agent(Claude Code / Kimi CLI / Codex / OpenCode / Qoder CLI / deepseek-harness 等);EvoFlow 不参与。SPMS 侧事实基于 `spms/src/db/schema.ts`、`spms/src/mcp/server.ts`、`spms/docs/MCP.md` 本次调查;ACP 支持矩阵基于 2026-09 公开资料核实(见 §9)。
> 本期交付:**SPMS 里的 issue 可以指派给人或 AI;每个 AI 逻辑员工(members 表 agent 行)1:1 绑定一个 Go agent_runner 和一个 Agent 引擎;指派即把工作流投递给对应 runner;runner 在 Docker 容器内拉起引擎执行开发 + E2E,进度/日志/证据全程回流 SPMS,结果评估后走既有 testing 验收门禁。**
> 本期的独特职责:runner 是**编排器 + 协议适配层**(出站注册、轮询取任务、下发任务、监控进度、执行工作流、回报日志产物、评估结果),不实现 LLM 循环;不是通用 CI。
> **本期不做智能派单——派给人还是派给哪个 AI 员工永远由人在 SPMS 界面决定;runner 只认领绑定员工的任务。**

## 0. 本期范围与决策

一句话定性:难点不在「Agent 会不会写代码」(引擎是成熟产品),而在 ① ACP 适配层的引擎差异抹平(会话/权限/中断/进度事件的语义各家不一);② 引擎认证与成本的多租户管理(订阅 OAuth vs API key);③ 结果评估要敢让人点「通过」。

| # | 决策点 | 选择 | 含义 |
| --- | --- | --- | --- |
| 1 | 形态 | SPMS 唯一控制平面;执行平面 = 自研 **agent_runner**(Go 单二进制,act_runner 模式:注册→出站长轮询→容器内执行→回报);EvoFlow 退出 | 新仓 `agent_runner`;SPMS 增 Runner API 与 runners 表;无第三方调度系统 |
| 2 | 员工↔runner↔引擎 | **三层 1:1:1**:agent member ↔ 一个 runner ↔ 一个引擎配置(`runtimeProfile.engine:{type,model,authRef}`);runner 只拉取绑定 member 的任务,只用绑定引擎执行 | 调度复杂度归零;「换引擎」= 改 member 配置;扩员工 = 加 members 行 + 起 runner |
| 3 | 引擎协议 | **ACP 为主**(stdio JSON-RPC,引擎作为 runner 子进程拉起);**headless CLI 为兜底适配器**(`claude -p`/`codex exec`/`opencode run`/`kimi -p` 等,各家均有);**A2A 不进本期**(面向远程 agent 服务,二期) | ACP 适配器矩阵已核实:Claude Code(`@agentclientprotocol/claude-agent-acp`)、Codex(`@zed-industries/codex-acp`)、Kimi CLI、Qoder CLI(`@qoder-ai/qodercli --acp`)、OpenCode(`opencode acp`)原生/半原生支持;引擎缺 ACP 时自动降级 headless |
| 4 | 指派协议 | runner 纯出站 HTTP 长轮询 SPMS `POST /api/v1/runner/poll`(30s);双方不开 inbound 端口 | NAT/防火墙友好;指派延迟 ≤ 长轮询返回 |
| 5 | 任务 = 工作流 | 指派载荷 = 工作流 YAML(schema v1);模板存 member `runtimeProfile.workflowTemplate`,SPMS 服务端用任务卡渲染后下发 | runner 无任务语义,只做 step 解释器;改流程不改二进制 |
| 6 | 执行隔离 | 每个 issue = 一个 Docker **job 容器**(DooD);镜像 `spms-worker:1`(git + 工具链 + Chromium + 各引擎 CLI 与 ACP adapter 预装);引擎子进程跑在容器内 | 任务间隔离;引擎的凭据/缓存随容器销毁;容器重建无状态 |
| 7 | E2E | 两条腿:① 引擎自己驱动(任务卡要求它用容器内浏览器工具自验,成熟引擎均有浏览器/终端能力);② runner 独立校验:chromedp 按断言清单复测留证据 | 不信任引擎自证;runner 侧校验是独立第二判据 |
| 8 | 结果评估 | `evaluate` step:断言清单机器核对(chromedp 结果 + 控制台/网络摘要)+ **评审引擎**(可用另一引擎做交叉评审,默认关)+ 证据包;结论写回 SPMS | 「过不过」不只看引擎自述;评审引擎是可选增强 |
| 9 | 回流通道 | Runner API(新增)→ SPMS **服务端内部**走既有门禁(`src/mcp/workflow.ts` 门禁判定下沉 service 层,唯一 refactor);runner 不直接改业务状态 | 门禁单点强制;MCP 34 工具保持人侧助手用途不变 |
| 10 | 鉴权与凭证 | runner token(SPMS 新 Bearer 面,sha256,绑 memberId);**引擎凭证**存 runner 本地 secret 文件(authRef 引用),按任务注入容器 env,SPMS 不存;Git token 同 | SPMS 泄露面不含引擎/Git 凭证;吊销 token 即停尸 runner |
| 11 | 代码合入 | 一律 `ai/<issueKey>` 分支 + PR;工作流 schema 无主干推送 step | AI 无主干写权限;验收入口永远是 PR + 证据 |

### 0.1 职责边界

|  | SPMS | agent_runner | 引擎(ACP/headless) | job 容器 |
| --- | --- | --- | --- | --- |
| 拥有 | 任务/需求/成员名册/runner 注册/工作流渲染/验收门禁/证据归档 | 轮询认领、工作流解释、容器生命周期、ACP 会话管理、进度监控、评估、上报 | 代码理解/修改/自构建/自述结论 | 项目代码、工具链、浏览器、引擎运行环境 |
| 红线 | 不感知容器/引擎细节 | **不实现 LLM 循环;不做业务状态判断;不跨绑定认领;不持久化产物** | 无 SPMS/Git 凭证之外的访问面 | 凭证只走 env;无状态 |

一句话:SPMS 管「做什么、谁验收」,runner 管「派给谁跑、跑到哪、结果信不信」,引擎管「怎么干」,容器管「在哪跑」。

### 0.2 关键取舍(显式记录而非默默处理)

- **a. ACP 主 + headless 兜底的双适配器。** ACP 给结构化会话(进度事件、权限请求、取消),headless 给最稳的一次性执行。代价:两套适配器都要维护,ACP adapter 版本随上游漂移(Claude/Codex 的 ACP 适配器是社区/Zed 维护)。缓解:引擎注册表按 `{type, versionPinned}` 锁版本;ACP 初始化握手失败自动降级 headless 并在日志标注;契约测试矩阵(§7.1)锁住各家语义。
- **b. 引擎差异抹平层。** 各引擎的权限模式(自动批准档位)、会话恢复、输出事件流语义不同。代价:适配层是持续维护负担;新引擎接入要过适配验收。缓解:适配器接口收窄到 5 个动词(`start/prompt/events/cancel/dispose`);事件归一化为 runner 自有 schema 再上报 SPMS,SPMS 永不感知引擎方言。
- **c. 1:1:1 绑定无调度器。** 代价:员工忙时排队,空闲 runner 不能代劳;引擎是按员工固定的,不能按任务挑引擎。缓解:queued 在 SPMS 可见可改派;二期池化认领(放宽 `runners.memberId` 唯一约束)+ 引擎路由规则。
- **d. 原子认领防重复交付。** 同 v2:对 `issues.execution` 条件写(仅 NULL/delivered/failed/canceled 可转 claimed),冲突 `ALREADY_CLAIMED`;一切上报带 runRef,不匹配即拒。**禁用内存标记/读后写。**
- **e. 引擎认证的双形态。** Claude Code 订阅(OAuth token)、各家 API key 形态不一,且有速率/额度差异。代价:authRef 体系要按引擎分类型;订阅 token 过期要人工续。缓解:runner 启动做 `doctor` 预检(引擎可用性+认证有效性+余额探测),预检失败拒绝上线并在 SPMS runner 页标红——故障左移到注册时。
- **f. 日志/事件回流限速。** 同 v2:4KB/200ms 批量 + 单 run 5MB 上限截断标注;`runner_logs` 每 issue 只留近 10 次 run。
- **g. 评估不信任引擎自证。** 引擎说「完成了」不算数:交付硬条件 = PR 存在 + chromedp 断言全过 + 证据附件齐全,三者缺一则 runner 判 failed/blocked。代价:无浏览器可断言的后端任务无法走全自动评估。缓解:任务卡允许声明 `e2e: false`,此类任务评估退化为「构建通过 + 引擎 diff 摘要 + 人审」。

### 0.3 明确不在本期

- **智能派单 / runner 池化 / 按任务挑引擎**——二期。
- **A2A 协议接入远程 agent 服务**——二期;本期只接本地 stdio 引擎。
- **脚本化 E2E 回归库**——二期,由断言清单场景沉淀。
- **动态镜像构建**——一期固定 `spms-worker:1`;项目特殊依赖由任务卡的 `env/install` step 容器内装。
- **引擎 Web/云形态**(Claude Code Web、Codex Cloud 等)——不接,只接本地 CLI。
- **计费/配额面板**——一期只做容器限额 + runner 并发=1 + doctor 余额探测。

## 1. 拓扑与改动面

**新仓 `agent_runner/`(Go,单二进制,★ 全新):**

- `cmd/runner/main.go`:配置(SPMS URL、runner token、docker host、authRef 文件路径)、`doctor` 预检、注册/保活。
- `internal/client/`:Runner API 客户端(长轮询/认领/心跳/日志/产物/状态),429/5xx 指数退避。
- `internal/engine/`:引擎注册表 + 适配器接口(`start/prompt/events/cancel/dispose`);`acp.go`(stdio JSON-RPC 客户端,会话/权限/事件/取消)+ `headless.go`(各家 CLI flag 矩阵 + 输出解析);事件归一化 schema。
- `internal/workflow/`:工作流 YAML 解析(schema v1)+ step 解释器;Docker 客户端(job 容器,`--memory/--cpus` 硬限额)。
- `internal/browser/`:chromedp 断言执行器(快照/断言核对/截图/控制台与网络采集)——runner 独立校验用。
- `internal/reporter/`:日志缓冲批量上传、证据打包、runRef 状态机、进度事件→SPMS。
- `images/spms-worker/Dockerfile` ★:git + 常用工具链 + Chromium + 各引擎 CLI 与 ACP adapter(版本锁定)。

**SPMS 仓(`spms/`)——增量清单,其余零改动:**

- `src/db/schema.ts` ★:`runners` 表;`issues.execution jsonb`;`members.runtimeProfile jsonb`(含 engine 与 workflowTemplate)。drizzle 迁移,列可空,回滚删列。
- `src/app/api/v1/runner/*/route.ts` ★:Runner API 六端点(§3),Bearer runner token 中间件(第三种凭证,与 cookie/MCP key 并列)。
- `src/server/services/runner.ts` ★:注册/认领/执行态机/日志落库/进度事件;**交付时内部调用既有 issues 服务门禁**(`src/mcp/workflow.ts` 门禁判定下沉 service 层——唯一对既有代码的 refactor,P0)。
- `src/app/(app)/` ★(M5):runner 管理页(注册码/在线状态/引擎 doctor 状态)、issue 详情「执行状态」块(状态+日志流+进度事件时间线+证据)、agent member 的引擎与工作流模板编辑。
- MCP 34 工具、REST `/api/v1/pms/**` 全部零改动。

**端口/env 新增(已核对不冲突):** SPMS 无新端口(挂 5175);runner env:`SPMS_URL`、`RUNNER_TOKEN`、`RUNNER_NAME`、`DOCKER_HOST`、`JOB_IMAGE`(默认 `spms-worker:1`)、`JOB_MEMORY`(4g)、`JOB_CPUS`(2)、`AUTH_STORE`(引擎/Git 凭证文件路径)。

## 2. 数据模型

| 表(spms) | 关键列 | 说明 |
| --- | --- | --- |
| `runners` ★新增 | `id uuid pk`、`companyId`、`memberId`(**唯一**)、`name`、`tokenHash`、`status online\|offline\|degraded`、`doctor jsonb`(引擎/认证预检结果)、`lastSeenAt`、`version` | 索引 `(companyId)`、`(memberId)` 唯一;吊销 = `revokedAt` |
| `issues` ★增量 | `execution jsonb`:`{state: queued\|claimed\|provisioning\|running\|e2e\|evaluating\|delivered\|failed\|blocked, runRef, runnerId, engine, progress:[{ts,msg}], artifacts:[{kind,url}], heartbeatAt, failReason, evalVerdict}` | 不进业务状态机;GIN 索引服务活跃扫描;认领条件写保证单活跃 run |
| `runner_logs` ★新增 | `id bigserial pk`、`companyId`、`issueKey`、`runRef`、`seq`、`chunk`、`createdAt` | 索引 `(issueKey,runRef,seq)`;每 issue 留近 10 次 run |
| `members` ★增量 | `runtimeProfile jsonb`:`{engine:{type,model,authRef}, workflowTemplate, e2e:bool}` | 仅 `type='agent'` 行;`engine.type` 枚举 = 引擎注册表 key |

约定:软引用(以 `issueKey`+`runRef` 互查);`execution` 写入权威 = Runner API 入参;引擎凭证**不进任何 SPMS 表**(authRef 只是 runner 本地 secret 的名字)。

## 3. 集成与契约

**Runner API 六端点(SPMS 新增,`/api/v1/runner/`,Bearer runner token,`{ok,data|error}` 信封):**

1. `POST /register` — 一次性注册码换 runner token,绑定 memberId。
2. `POST /poll` — 长轮询(30s):返回绑定 member 的最早 `queued` issue + 渲染后工作流 + 任务卡。闸门顺序:token → 公司 → member 绑定。
3. `POST /claim {issueKey, runRef}` — 原子条件写(§0.2-d);冲突 `ALREADY_CLAIMED`。
4. `POST /heartbeat {runRef?, doctor?}` — 更新 `lastSeenAt`/`heartbeatAt`;僵尸 = 90s 无心跳且无进展。
5. `POST /runs/:runRef/logs` / `POST /runs/:runRef/artifacts` — 日志批量追加 / 证据上传(复用既有附件存储,`spms_upload_issue_attachment` 同款路径)。
6. `POST /runs/:runRef/state {state, progress?, evalVerdict?, failReason?}` — 执行态推进;`delivered` 时 SPMS 服务端内部走门禁(审查→testing;TESTS_NOT_PASSED 回执 runner 补一轮,最多 2 轮)。

**上游契约核对:**

- issue 门禁(`src/mcp/workflow.ts`):**增量**——下沉 service 层供 Runner API 复用;漏则 runner 交付绕门禁。P0。
- 附件存储:`spms_upload_issue_attachment` **已核实存在**,复用其存储与可见性。
- MCP 34 工具:**已核实零改动**。
- 引擎侧(外部依赖,非本仓):ACP 适配器可用性矩阵已按公开资料核实(§0-3);**版本锁定 + 契约测试兜底**,升级引擎 = 显式改版本 pin 并重跑契约矩阵。

**种子/配置清单:** ① drizzle 迁移 + seed 兼容;② UI 签发注册码 → runner 注册;③ agent member 配 `runtimeProfile.engine` + workflowTemplate(默认三件套:develop/evaluate/report);④ 构建 `spms-worker:1` 镜像;⑤ runner 机器上配 `AUTH_STORE`(各引擎凭证 + Git token)。

## 4. 服务端机制(核心业务)

**工作流 schema v1:**

```yaml
version: 1
task: {issueKey, runRef, repo, branch: "ai/<issueKey>"}
taskcard: {goal, acceptance, assertions: [...], e2e: true}
engine: {type: "claude-code", model: "..."}     # SPMS 从 runtimeProfile 渲染
steps:
  - uses: git/setup        # clone + 建分支,token 走 env
  - uses: env/install      # 依赖安装(lockfile 探测)
  - uses: agent/develop    # ACP/headless 驱动引擎:任务卡→改码→自构建→自述
  - uses: browser/verify   # runner 独立校验:chromedp 按 assertions 复测留证据
  - uses: evaluate         # 交付硬条件核对 + 可选评审引擎 → evalVerdict
  - uses: report/submit    # PR 链接 + 证据清单 + 结论
```

**主链路(每步注明凭证):**

1. 人指派 issue 给 agent member → `execution.state='queued'`(SPMS session)。
2. runner `poll`(runner token)→ `claim` 原子认领 → 起 job 容器(docker socket):预装镜像、env 注入引擎凭证+Git token、硬限额;`provisioning`→`running`。
3. `git/setup`/`env/install` 失败 → `failed + failReason` → 终态。
4. `agent/develop`:runner 以 ACP 拉起引擎子进程(失败降级 headless),下发渲染后的任务卡 prompt;**进度事件归一化后随 heartbeat/日志回流**(SPMS 侧看到「引擎正在改 src/xxx.ts」级时间线);引擎自述完成 → 推分支 + PR(Git token)。
5. `browser/verify`:`e2e:true` 时 runner 用 chromedp 逐条断言复测(独立于引擎),每条留截图+控制台/网络摘要 → artifacts。
6. `evaluate`:硬条件核对(PR 存在?断言全过?证据齐?)→ `evalVerdict: pass|fail`;可选评审引擎交叉评审 diff(默认关)。
7. `report/submit` → SPMS 服务端门禁 → testing(附证据与 verdict);门禁败 → 回执 runner 补一轮(≤2 轮)→ 仍败 `blocked` + 评论@负责人。
8. 人验收:PR + 证据 + 引擎过程时间线 + evalVerdict → done / 打回(execution 重置 queued 可重派)。

**门(全部服务端强制):** runner token → 公司/绑定 → 认领条件写 → 资源限额 → 分支命名空间 `ai/*` → 评估硬条件 → 既有业务门禁(最后)。

**竞态收口:** §0.2-d 条件写;runRef 防僵尸;心跳 90s 阈值;容器名确定性(重复=复用);SPMS 重启后长轮询队列重挂,runner 自动重连;引擎子进程崩溃 → runner 捕获退出码,ACP 可恢复会话则 resume,否则 headless 重跑一步。

## 5. 前端(SPMS,M5 集中交付)

- **runner 管理页**:注册码签发(选 member)、在线/degraded/离线、**引擎 doctor 状态**(认证有效/余额/版本)、吊销。
- **issue 详情「执行状态」块**:8 态徽章、引擎类型标识、进度事件时间线、日志流(轮询 5s)、证据附件、evalVerdict、failReason+「重新指派」。
- **agent member 编辑**:引擎选择(注册表下拉)+ model + authRef + 工作流模板(schema 校验)。
- **空态/错误态**:未指派 AI 不渲染;runner 离线显示「等待 runner 上线」;引擎认证失效显示「引擎凭证失效」。
- 看板/迭代/报表零改动自动受益(人/AI 同表)。

## 6. 安全清单(验收断言的来源)

1. runner token sha256 落库、绑 memberId;断言:token A 拉不到 member B 的任务。
2. 认领条件写防双交付;断言:双 runner 并发 claim 同 issue 仅一个 runRef 成立。
3. 僵尸 runRef 一切上报被拒;断言:过期 runRef 调 state/logs 返回业务错误。
4. 引擎凭证与 Git token 只进容器 env、authRef 只是名字;断言:SPMS 数据库/API 响应/`runner_logs` grep 无任何凭证值;日志上传前 runner 按 AUTH_STORE 值表脱敏。
5. 容器硬限额 + 单并发;断言:超限被 OOM/限速;第二任务保持 queued。
6. 容器出站白名单(git 主机 + 引擎 API 域名 + SPMS);断言:容器内 curl 任意外网超时。
7. 引擎权限模式锁自动批准上限:断言:容器内引擎配置文件的 permission/auto-approve 档位 ≤ 模板上限(防模板注入提权)。
8. 业务门禁不可绕过:断言:Runner API 无直接改 `issue_status` 入口;delivered 必经 TESTS_NOT_PASSED 门禁。

## 7. 验证

### 7.1 自动化断言脚本

- `verify-claim-race`:并发认领(安全 2)。
- `verify-lifecycle-e2e` ★核心:造 issue → 指派 → execution 全状态序列 → 日志/进度/证据/evalVerdict 齐全 → 门禁流转 testing。
- `verify-binding`(安全 1)、`verify-zombie`(安全 3)、`verify-limits`(安全 5、6)、`verify-secrets`(安全 4、7)、`verify-gate`(安全 8)。
- `verify-engine-contract` ★核心:**引擎契约矩阵**——每个接入引擎跑同一组探针任务:ACP 握手/进度事件/取消/中断恢复/降级 headless;引擎版本升级必重跑。
- `verify-evaluate`:evalVerdict 三条硬条件各自的 fail 路径(无 PR/断言失败/证据缺失)。

### 7.2 跨模块回归

- SPMS:既有工作流门禁测试全绿(门禁下沉 refactor 的回归门);issue/评论/附件既有测试全绿;MCP 34 工具冒烟。

### 7.3 真实环境走查

起 SPMS + runner + dockerd → 注册绑定 forge(引擎=Claude Code)→ 指派「加一个待办列表页」→ 看进度时间线流动 → PR 出现 → chromedp 证据附件齐全 → evalVerdict=pass → 门禁进 testing → 人打回 → 重派 → 确认完成。故障注入:杀容器(90s 后 failed)、杀引擎子进程(resume/降级)、引擎 token 失效(doctor 标红拒上线)、吊销 runner token、双 runner 抢单。换引擎走查:同一任务改派引擎=OpenCode 的员工,流程一致。

### 7.4 静态校验

SPMS typecheck/lint + 迁移回滚演练;agent_runner `go vet` + 单测(YAML 解析、ACP 编解码、脱敏、退避)。

## 8. 里程碑(每步可验证)

| # | 里程碑 | 内容 | 验证 |
| --- | --- | --- | --- |
| M1 | 端到端直通(echo) | SPMS:runners/Runner API/execution 列;runner:register/poll/claim/心跳/echo step | verify-lifecycle-e2e(echo 版)绿;门禁回归全绿 |
| M2 | 容器与首个引擎 | job 容器 + git/env step + **Claude Code ACP 适配器**(含 headless 降级)+ 日志/进度/产物回流 | 走查 PR 出现;verify-engine-contract(Claude Code)绿;verify-limits/secrets 绿 |
| M3 | 独立校验与评估 | browser/verify(chromedp)+ evaluate 硬条件 + 门禁下沉 refactor | verify-evaluate、verify-gate、verify-claim-race、verify-zombie 绿;§7.3 全流程走查 |
| M4 | 引擎矩阵扩展 | Kimi CLI / Codex / OpenCode / Qoder CLI / deepseek-harness 逐个过契约矩阵接入 | 每引擎 verify-engine-contract 绿;换引擎走查通过 |
| M5 | SPMS 前端 | runner 管理页 + 执行状态块 + doctor 状态 + 模板编辑 | 三态走查;doctor 标红路径走查 |
| M6 | 加固收尾 | 限额/脱敏回归、文档、挂总验证 | 全量回归 + §7.3 全链路 + §6 八条断言全过 |

## 9. 风险与开放问题

- **最大风险:ACP 适配器的上游漂移**(Claude/Codex 的 ACP adapter 由 Zed/社区维护,语义随版本变)。门:版本 pin + `verify-engine-contract` 契约矩阵 + headless 降级兜底;升级引擎是显式动作。
- **次大风险:引擎订阅/额度在无人值守下烧穿**。门:doctor 余额探测 + runner 并发=1 + 每任务 token 用量随 report 回流(引擎事件流可取值),超额任务自动 blocked。
- **开放问题(实现前确认):** ① 首批接入引擎顺序(默认 Claude Code → Kimi CLI → OpenCode → Codex → Qoder CLI → deepseek-harness;各家 ACP 成熟度不一,deepseek-harness 的 ACP 支持据公开资料为「ACP+SDK+JSON-RPC」但需实测,排最后);② 引擎认证形态(订阅 OAuth 还是 API key,按引擎逐个定);③ Git 平台(默认 Gitea);④ 评审引擎是否启用及用哪家(默认关);⑤ 无浏览器可断言的后端任务是否允许 `e2e:false`(默认允许,评估降级为构建+diff 摘要+人审)。
- **发现的全局缺口:** SPMS 无队列/定时基建(长轮询驻内存,单容器成立,水平扩展需重设计);进程内限流不适用于 runner 面(Runner API 不挂登录限流器)。

## 10. 已知坑(沿用既有教训)

- **P0:workflow.ts 门禁逻辑在 MCP 层**——Runner API 复用前必须下沉 service 层(§3)。
- SPMS 登录限流是进程内 Map(`src/lib/rateLimit.ts`)——Runner API 不挂该限流器;runner 断线重连须指数退避。
- Chrome 136+ `--remote-debugging-port` 不能挂默认 user-data-dir——容器内 Chrome 显式独立 profile。
- SPMS 信封 = 200+`{ok:false}`——runner 重试必须解析业务码。
- MCP 工具自带流转约定:「上传截图后置 done 自动流转 testing 并指派测试员」(`spms/src/mcp/server.ts` L812–817)——Runner API 交付路径行为必须对齐,不造第二套语义。
- 各引擎 headless 模式的权限提示会阻塞无 tty 执行(如 OpenCode 需 `permission:"allow"`)——镜像内引擎配置模板必须预置无人值守档位,同时受 §6-7 上限约束。

## 11. 需求 → 设计映射(自检)

| # | 需求 | 本期落点 |
| --- | --- | --- |
| R1 | SPMS 驱动人与 AI 协同 | members 人/机同构 assignee(已核实 `schema.ts` L279–315)+ §4 主链路 |
| R2 | Go 开发 agent_runner | §1 新仓结构 + M1–M4 |
| R3 | 每个 AI 逻辑员工连接一个 runner | §0-2 三层 1:1:1 + `runners.memberId` 唯一 + verify-binding |
| R4 | 指派 = 下发工作流 | §0-5 + §3 poll/claim + §4 schema v1 |
| R5 | 不自建 Agent,ACP/A2A 接成熟引擎(Claude Code/Kimi/Codex/OpenCode/Qoder/deepseek-harness) | §0-3 双适配器 + §1 internal/engine + M2/M4 引擎矩阵;A2A → §0.3 二期 |
| R6 | runner 职责:出站注册/轮询/下发/监控进度/执行工作流/回报日志产物/评估结果 | §3 Runner API + §4 步骤 2–7 + internal/reporter + evaluate step |
| R7 | Agent 驱动浏览器 E2E | §0-7 双腿 + browser/verify + 断言清单证据链 |
| R8 | 安全与门禁 | §6 八条 + §7.1 对应脚本 |
| — | **不在本期**:智能派单/池化/A2A 远程/动态镜像/脚本回归库/EvoFlow | §0.3 |
