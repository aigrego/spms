import type { Locale } from '@/lib/i18n';

/* 生命周期指引(/guide,TKT-68)的长文案内容。长文案不走 t() 词典(见
   i18n/plans.ts 注释),按 Locale 存结构化数据,页面组件直接渲染。
   文案必须与 SPMS 实际能力一致,不照搬竞品:提及的功能入口、状态流转、
   MCP 工具名均以本系统实现为准。 */

export interface GuideStep {
  letter: string; // 'a'–'i',时间轴上的圆圈字母
  title: string;
  badges: ('human' | 'agent')[]; // human=人工完成 / agent=AI Agent 完成
  owner: string;
  body: string[]; // 段落
  codes?: string[]; // 等宽代码块
  link?: { label: string; href: string };
}

export interface GuideTestScenario {
  title: string; // 场景名
  when: string; // 触发时机
  prompt: string; // 可直接下发给 Agent 的示例提示词
  codes: string[]; // 等宽代码块(MCP 调用链)
}

export interface GuideContent {
  title: string;
  subtitle: string;
  badgeHuman: string;
  badgeAgent: string;
  steps: GuideStep[];
  /* Agent 驱动的测试场景:时间轴之后的补充区块,列出三类套件执行的提示词范式。 */
  testSection: { title: string; intro: string; scenarios: GuideTestScenario[] };
  footer: string;
}

export const GUIDE: Record<Locale, GuideContent> = {
  'zh-CN': {
    title: '研发生命周期指引',
    subtitle: '从立产品线到需求验收，一份需求在 SPMS 里要走完的九步。每步注明谁来做、人工还是 AI Agent。',
    badgeHuman: '人工完成',
    badgeAgent: 'AI Agent 完成',
    steps: [
      {
        letter: 'a',
        title: '立产品线与产品',
        badges: ['human'],
        owner: '产品总监 / PM 主管',
        body: [
          '产品线 → 产品是整条生命周期的根。这一层建错，后面的版本、项目、需求全部错位，而且 key 已经烧掉、改不回来，所以先把它定下来。',
        ],
        link: { label: '打开产品', href: '/products' },
      },
      {
        letter: 'b',
        title: '立版本与项目',
        badges: ['human'],
        owner: '产品总监 / PM 主管',
        body: [
          '版本挂在产品下，项目挂在版本下。需求只能挂在项目上，没有对应项目就先建一个，不要把需求塞进一个看起来相近的项目。',
        ],
        link: { label: '打开项目', href: '/projects' },
      },
      {
        letter: 'c',
        title: '写 PRD，拆成 FR / NFR 与测试用例种子',
        badges: ['agent', 'human'],
        owner: '产品负责人 / 执行 PM',
        body: [
          'PRD 由 Agent 起草：拆得出条目的进需求池，成为 FR / NFR；项目的概述、目标、非目标填进「项目 → 基本信息」。写库前必须人工确认：创建接口不幂等，重复调用就会造出重复需求。',
          'Agent 通过 MCP 接入 SPMS，令牌在「Agent 接入」页自助申请。',
        ],
        codes: ['MCP: spms_create_requirement · spms_create_test_case'],
        link: { label: '打开需求池', href: '/requirements' },
      },
      {
        letter: 'd',
        title: '把需求拆解为工单',
        badges: ['human'],
        owner: '产品负责人 / 执行 PM',
        body: [
          '在需求详情点「拆解」，系统按验收标准逐行拆出 TKT（验收标准为空则按描述行），继承需求的项目、优先级与重要度并自动关联回需求，一次最多 20 条、key 连号。Agent 也可以直接调 spms_decompose_requirement 完成同样的拆解。',
        ],
        link: { label: '打开需求池', href: '/requirements' },
      },
      {
        letter: 'e',
        title: '建 Sprint，把 Issue 拖进迭代',
        badges: ['human'],
        owner: '产品负责人 / 执行 PM',
        body: [
          '迭代建议一周。同一项目同一时间只允许一个进行中的 Sprint，想开下一个，先把当前这个结掉。',
        ],
        link: { label: '打开产品待办', href: '/backlog' },
      },
      {
        letter: 'f',
        title: '给已排期的条目估点',
        badges: ['agent'],
        owner: 'AI Agent',
        body: [
          '工单拖入迭代时，未估点的条目默认记 1 点；需要更准的评估时，Agent 按复杂度写入故事点（1/2/3/5/8），人工可随时覆盖。故事点只做容量参考，不做绩效依据。',
        ],
        codes: ['MCP: spms_update_issue (storyPoints) · spms_move_issue_to_sprint'],
      },
      {
        letter: 'g',
        title: '出开发计划，补测试用例',
        badges: ['agent'],
        owner: '开发人员 / 测试人员',
        body: [
          '在「项目 → 开发计划」tab 新建计划并关联 FR / NFR：一份计划可以覆盖多条需求，一条需求也可以拆给多份计划，关联键是 FR / NFR key 而不是文件名。Agent 通过 MCP 把计划内容写入并转「已生成」。测试用例要覆盖正常、边界、权限、并发四类。',
          '每条用例还要定测试类别：functional 功能（默认，工单关单的门禁依据，TDD 场景直接挂到工单）、smoke 冒烟（部署后核心链路）、integration 集成（版本发布的门禁依据）、regression 回归（hotfix 后验证无退化）。',
        ],
        codes: ['MCP: spms_create_plan → spms_update_plan', 'MCP: spms_create_test_case (category/issueId)'],
        link: { label: '打开测试用例', href: '/testcases' },
      },
      {
        letter: 'h',
        title: '第一道验收：工单走完交付链，用例通过才关单',
        badges: ['human'],
        owner: '开发人员（转）+ 测试人员（验）',
        body: [
          '开发按实际进展推状态：开工转「进行中」，开发完成转「待测试」（系统自动指派测试人员）。测试人员执行关联用例（spms_run_test_suite 一条命令批量记录结果），用例全部通过才能把工单转「已完成」——关联用例未全过时关单会被门禁拦截（TESTS_NOT_PASSED）。',
        ],
        codes: ['MCP: spms_run_test_suite · spms_update_issue (force)'],
        link: { label: '打开我的 Issues', href: '/my-issues' },
      },
      {
        letter: 'i',
        title: '第二道验收：全部工单完成后，把需求转「已上线」',
        badges: ['human'],
        owner: '需求作者与负责人',
        body: [
          '需求名下的工单全部完成后，由需求作者或负责人在需求详情手动把状态转为「已上线」。「已上线」是需求侧的终态：点这一下就是需求级验收，系统绝不自动改状态。',
          '版本上线前先做集成测试：Agent 用 spms_run_test_suite(category=integration, releaseId=…) 批量执行并记录，全部通过后版本才能转「已发布」；部署后用 smoke 套件做冒烟，hotfix 后用 regression 套件做回归。',
        ],
        link: { label: '打开需求池', href: '/requirements' },
      },
    ],
    testSection: {
      title: 'Agent 驱动的测试场景',
      intro:
        '三类套件执行都由 AI Agent 经 MCP 一条命令完成：先调 spms_run_test_suite（不传 results）取出待执行套件，逐条执行后再带 results 回调记录——结果写入用例并留痕 test_runs（谁/何时/哪类套件）。下面三段提示词可以直接下发给已接入的 Agent。',
      scenarios: [
        {
          title: '功能开发 · TDD 最小闭环',
          when: '时机：工单开发完成转入「待测试」之后。关联用例（挂工单的 ∪ 挂需求的 functional 用例）全部 passed 才允许关单。',
          prompt: '「给 TKT-124 建 functional 测试用例并挂到工单（issueId=TKT-124）。执行这些用例并用 spms_run_test_suite 记录结果，全部 passed 后把工单转 done 关单；被门禁拦了就把阻塞用例清单报给我。」',
          codes: ['spms_create_test_case (category=functional, issueId)', 'spms_run_test_suite (category=functional) → spms_update_issue (done / force)'],
        },
        {
          title: '版本部署 · 冒烟 + 上线前集成',
          when: '时机：每次部署后立即冒烟；版本全部开发完、转「已发布」之前跑集成测试——integration 用例全过才放行。',
          prompt: '「项目 X 刚部署完，跑冒烟套件，note 写 v1.2.0 部署后冒烟。」「版本 V 准备发布：执行集成测试并记录，全部 passed 后把版本转已发布；被拦就列出没过的用例。」',
          codes: ['spms_run_test_suite (category=smoke, projectId)', 'spms_run_test_suite (category=integration, releaseId) → spms_update_release (released / force)'],
        },
        {
          title: 'hotfix · 回归',
          when: '时机：hotfix 修复部署后，验证既有功能无退化；失败的用例可直接转成 BUG 工单继续跟踪。',
          prompt: '「hotfix 已部署，对项目 X 跑回归套件，failed 的用例 raiseBugs=true 自动建 BUG，最后把执行汇总和新建的 BUG key 给我。」',
          codes: ['spms_run_test_suite (category=regression, raiseBugs=true)', 'spms_list_test_runs（执行历史）'],
        },
      ],
    },
    footer:
      '本页是推荐流程。除两处测试门禁（工单关单看 functional 用例、版本发布看 integration 用例，均可 force 覆盖）外，SPMS 不按这九步拦截任何操作。这里写的是团队约定的做法，遇到例外按实际情况来。',
  },
  en: {
    title: 'R&D Lifecycle Guide',
    subtitle:
      'From product line to requirement acceptance — the nine steps a requirement walks through in SPMS. Each step notes who does it: a human or an AI Agent.',
    badgeHuman: 'Done by a human',
    badgeAgent: 'Done by an AI Agent',
    steps: [
      {
        letter: 'a',
        title: 'Create the product line and product',
        badges: ['human'],
        owner: 'Product Director / PM Lead',
        body: [
          'Product line → product is the root of the whole lifecycle. Get this layer wrong and every release, project, and requirement below it lands in the wrong place — and the keys are already burned and cannot be taken back. Settle this layer first.',
        ],
        link: { label: 'Open Products', href: '/products' },
      },
      {
        letter: 'b',
        title: 'Create the release and project',
        badges: ['human'],
        owner: 'Product Director / PM Lead',
        body: [
          'Releases hang under products; projects hang under releases. Requirements can only attach to a project — if there is no matching project, create one instead of stuffing the requirement into one that merely looks close.',
        ],
        link: { label: 'Open Projects', href: '/projects' },
      },
      {
        letter: 'c',
        title: 'Write the PRD, split into FR / NFR and test-case seeds',
        badges: ['agent', 'human'],
        owner: 'Product Owner / Executing PM',
        body: [
          'The Agent drafts the PRD: whatever decomposes into items goes into the requirement pool as FRs / NFRs; the project\u2019s summary, goals, and non-goals go into "Project → Basic info". A human must confirm before anything is written: the create API is not idempotent — call it twice and you get duplicate requirements.',
          'Agents connect to SPMS over MCP; tokens are self-issued on the "Agent Access" page.',
        ],
        codes: ['MCP: spms_create_requirement · spms_create_test_case'],
        link: { label: 'Open Requirement Pool', href: '/requirements' },
      },
      {
        letter: 'd',
        title: 'Break requirements down into tickets',
        badges: ['human'],
        owner: 'Product Owner / Executing PM',
        body: [
          'Click "Decompose" on the requirement detail and the system splits the acceptance criteria line by line into TKTs (falling back to description lines), inheriting the requirement\u2019s project, priority, and importance and linking back to it — up to 20 at a time, with consecutive keys. An Agent can do the same via spms_decompose_requirement.',
        ],
        link: { label: 'Open Requirement Pool', href: '/requirements' },
      },
      {
        letter: 'e',
        title: 'Create a Sprint and drag issues into it',
        badges: ['human'],
        owner: 'Product Owner / Executing PM',
        body: [
          'One week per sprint is recommended. Only one active sprint is allowed per project at a time — to start the next one, close out the current one first.',
        ],
        link: { label: 'Open Backlog', href: '/backlog' },
      },
      {
        letter: 'f',
        title: 'Estimate points for scheduled items',
        badges: ['agent'],
        owner: 'AI Agent',
        body: [
          'A ticket dragged into a sprint without an estimate gets 1 point by default; when a real estimate is needed, the Agent writes story points (1/2/3/5/8) based on complexity, and humans can override at any time. Story points are a capacity reference, not a performance metric.',
        ],
        codes: ['MCP: spms_update_issue (storyPoints) · spms_move_issue_to_sprint'],
      },
      {
        letter: 'g',
        title: 'Produce the dev plan, backfill test cases',
        badges: ['agent'],
        owner: 'Developer / Tester',
        body: [
          'Create a plan in the "Project → Dev Plans" tab and link FRs / NFRs: one plan can cover several requirements, and one requirement can be split across several plans — the link key is the FR / NFR key, not a file name. The Agent writes the plan content over MCP and marks it "Generated". Test cases must cover four classes: happy path, boundary, permission, and concurrency.',
          'Every case also gets a category: functional (default — the gate for closing tickets; attach it to the ticket in TDD flows), smoke (post-deploy core-path check), integration (the gate for releasing a version), regression (post-hotfix no-degradation check).',
        ],
        codes: ['MCP: spms_create_plan → spms_update_plan', 'MCP: spms_create_test_case (category/issueId)'],
        link: { label: 'Open Test Cases', href: '/testcases' },
      },
      {
        letter: 'h',
        title: 'First acceptance: tickets walk the delivery chain, cases pass before closing',
        badges: ['human'],
        owner: 'Developer (hands over) + Tester (verifies)',
        body: [
          'Developers move status with real progress: starting work moves a ticket to "In Progress"; finishing development moves it to "Testing" (the system auto-assigns a tester). The tester runs the linked cases (spms_run_test_suite records a whole suite in one call), and the ticket can only move to "Done" once every linked case has passed — closing with unpassed cases is blocked by the gate (TESTS_NOT_PASSED).',
        ],
        codes: ['MCP: spms_run_test_suite · spms_update_issue (force)'],
        link: { label: 'Open My Issues', href: '/my-issues' },
      },
      {
        letter: 'i',
        title: 'Second acceptance: once all tickets are done, mark the requirement "Shipped"',
        badges: ['human'],
        owner: 'Requirement author and owner',
        body: [
          'When every ticket under a requirement is done, the requirement author or owner manually moves it to "Shipped" on the requirement detail. "Shipped" is the terminal state on the requirement side: that one click IS the requirement-level acceptance — the system never changes status on its own.',
          'Before a version goes live, run integration tests: the Agent executes and records them via spms_run_test_suite(category=integration, releaseId=…), and the release can only turn "Released" once all of them pass. After deployment run the smoke suite; after a hotfix run the regression suite.',
        ],
        link: { label: 'Open Requirement Pool', href: '/requirements' },
      },
    ],
    testSection: {
      title: 'Agent-driven test scenarios',
      intro:
        'All three suite runs are done by an AI Agent over MCP in a single command: call spms_run_test_suite without results to fetch the pending suite, execute each case, then call it again with results to record — outcomes land on the cases and are logged in test_runs (who / when / which suite). The three prompts below can be handed to a connected Agent as-is.',
      scenarios: [
        {
          title: 'Feature development · the TDD minimal loop',
          when: 'When: after a ticket finishes development and moves to "Testing". Linked cases (attached to the ticket ∪ functional cases on its requirement) must all pass before it can close.',
          prompt: '"Create functional test cases for TKT-124 linked to the ticket (issueId=TKT-124). Execute them and record the results with spms_run_test_suite, then move the ticket to done once everything passes; if the gate blocks you, report the blocking cases back to me."',
          codes: ['spms_create_test_case (category=functional, issueId)', 'spms_run_test_suite (category=functional) → spms_update_issue (done / force)'],
        },
        {
          title: 'Release deployment · smoke + pre-release integration',
          when: 'When: smoke right after every deployment; run integration tests before a fully-developed version turns "Released" — it only proceeds once every integration case has passed.',
          prompt: '"Project X was just deployed — run the smoke suite with note \u2018v1.2.0 post-deploy smoke\u2019." "Version V is ready to ship: execute the integration tests and record them, then mark the release as released; if blocked, list the cases that have not passed."',
          codes: ['spms_run_test_suite (category=smoke, projectId)', 'spms_run_test_suite (category=integration, releaseId) → spms_update_release (released / force)'],
        },
        {
          title: 'Hotfix · regression',
          when: 'When: after a hotfix is deployed, to verify nothing else broke; failed cases can be turned straight into BUG tickets for tracking.',
          prompt: '"The hotfix is deployed — run the regression suite on project X with raiseBugs=true so failed cases auto-file BUGs, then give me the run summary and the new BUG keys."',
          codes: ['spms_run_test_suite (category=regression, raiseBugs=true)', 'spms_list_test_runs (run history)'],
        },
      ],
    },
    footer:
      'This page is a recommended workflow. Apart from the two test gates (functional cases guard ticket closure, integration cases guard releases — both force-overridable), SPMS does not block any operation based on these nine steps. It records the team\u2019s agreed practice — handle exceptions case by case.',
  },
  'zh-TW': {
    title: '研發生命週期指引',
    subtitle: '從立產品線到需求驗收，一份需求在 SPMS 裡要走完的九步。每步註明誰來做、人工還是 AI Agent。',
    badgeHuman: '人工完成',
    badgeAgent: 'AI Agent 完成',
    steps: [
      {
        letter: 'a',
        title: '立產品線與產品',
        badges: ['human'],
        owner: '產品總監 / PM 主管',
        body: [
          '產品線 → 產品是整條生命週期的根。這一層建錯，後面的版本、專案、需求全部錯位，而且 key 已經燒掉、改不回來，所以先把它定下來。',
        ],
        link: { label: '打開產品', href: '/products' },
      },
      {
        letter: 'b',
        title: '立版本與專案',
        badges: ['human'],
        owner: '產品總監 / PM 主管',
        body: [
          '版本掛在產品下，專案掛在版本下。需求只能掛在專案上，沒有對應專案就先建一個，不要把需求塞進一個看起來相近的專案。',
        ],
        link: { label: '打開專案', href: '/projects' },
      },
      {
        letter: 'c',
        title: '寫 PRD，拆成 FR / NFR 與測試用例種子',
        badges: ['agent', 'human'],
        owner: '產品負責人 / 執行 PM',
        body: [
          'PRD 由 Agent 起草：拆得出條目的進需求池，成為 FR / NFR；專案的概述、目標、非目標填進「專案 → 基本資訊」。寫庫前必須人工確認：建立介面不冪等，重複呼叫就會造出重複需求。',
          'Agent 透過 MCP 接入 SPMS，令牌在「Agent 接入」頁自助申請。',
        ],
        codes: ['MCP: spms_create_requirement · spms_create_test_case'],
        link: { label: '打開需求池', href: '/requirements' },
      },
      {
        letter: 'd',
        title: '把需求拆解為工單',
        badges: ['human'],
        owner: '產品負責人 / 執行 PM',
        body: [
          '在需求詳情點「拆解」，系統按驗收標準逐行拆出 TKT（驗收標準為空則按描述行），繼承需求的專案、優先級與重要度並自動關聯回需求，一次最多 20 條、key 連號。Agent 也可以直接呼叫 spms_decompose_requirement 完成同樣的拆解。',
        ],
        link: { label: '打開需求池', href: '/requirements' },
      },
      {
        letter: 'e',
        title: '建 Sprint，把 Issue 拖進迭代',
        badges: ['human'],
        owner: '產品負責人 / 執行 PM',
        body: [
          '迭代建議一週。同一專案同一時間只允許一個進行中的 Sprint，想開下一個，先把目前這個結掉。',
        ],
        link: { label: '打開產品待辦', href: '/backlog' },
      },
      {
        letter: 'f',
        title: '給已排期的條目估點',
        badges: ['agent'],
        owner: 'AI Agent',
        body: [
          '工單拖入迭代時，未估點的條目預設記 1 點；需要更準的評估時，Agent 按複雜度寫入故事點（1/2/3/5/8），人工可隨時覆蓋。故事點只做容量參考，不做績效依據。',
        ],
        codes: ['MCP: spms_update_issue (storyPoints) · spms_move_issue_to_sprint'],
      },
      {
        letter: 'g',
        title: '出開發計劃，補測試用例',
        badges: ['agent'],
        owner: '開發人員 / 測試人員',
        body: [
          '在「專案 → 開發計劃」tab 新建計劃並關聯 FR / NFR：一份計劃可以覆蓋多條需求，一條需求也可以拆給多份計劃，關聯鍵是 FR / NFR key 而不是檔名。Agent 透過 MCP 把計劃內容寫入並轉「已生成」。測試用例要覆蓋正常、邊界、權限、並發四類。',
          '每條用例還要定測試類別：functional 功能（預設，工單關單的門禁依據，TDD 場景直接掛到工單）、smoke 冒煙（部署後核心鏈路）、integration 整合（版本發佈的門禁依據）、regression 回歸（hotfix 後驗證無退化）。',
        ],
        codes: ['MCP: spms_create_plan → spms_update_plan', 'MCP: spms_create_test_case (category/issueId)'],
        link: { label: '打開測試用例', href: '/testcases' },
      },
      {
        letter: 'h',
        title: '第一道驗收：工單走完交付鏈，用例通過才關單',
        badges: ['human'],
        owner: '開發人員（轉）+ 測試人員（驗）',
        body: [
          '開發按實際進展推狀態：開工轉「進行中」，開發完成轉「待測試」（系統自動指派測試人員）。測試人員執行關聯用例（spms_run_test_suite 一條命令批量記錄結果），用例全部通過才能把工單轉「已完成」——關聯用例未全過時關單會被門禁攔截（TESTS_NOT_PASSED）。',
        ],
        codes: ['MCP: spms_run_test_suite · spms_update_issue (force)'],
        link: { label: '打開我的 Issues', href: '/my-issues' },
      },
      {
        letter: 'i',
        title: '第二道驗收：全部工單完成後，把需求轉「已上線」',
        badges: ['human'],
        owner: '需求作者與負責人',
        body: [
          '需求名下的工單全部完成後，由需求作者或負責人在需求詳情手動把狀態轉為「已上線」。「已上線」是需求側的終態：點這一下就是需求級驗收，系統絕不自動改狀態。',
          '版本上線前先做整合測試：Agent 用 spms_run_test_suite(category=integration, releaseId=…) 批量執行並記錄，全部通過後版本才能轉「已發佈」；部署後用 smoke 套件做冒煙，hotfix 後用 regression 套件做回歸。',
        ],
        link: { label: '打開需求池', href: '/requirements' },
      },
    ],
    testSection: {
      title: 'Agent 驅動的測試場景',
      intro:
        '三類套件執行都由 AI Agent 經 MCP 一條命令完成：先呼叫 spms_run_test_suite（不傳 results）取出待執行套件，逐條執行後再帶 results 回呼記錄——結果寫入用例並留痕 test_runs（誰/何時/哪類套件）。下面三段提示詞可以直接下發給已接入的 Agent。',
      scenarios: [
        {
          title: '功能開發 · TDD 最小閉環',
          when: '時機：工單開發完成轉入「待測試」之後。關聯用例（掛工單的 ∪ 掛需求的 functional 用例）全部 passed 才允許關單。',
          prompt: '「給 TKT-124 建 functional 測試用例並掛到工單（issueId=TKT-124）。執行這些用例並用 spms_run_test_suite 記錄結果，全部 passed 後把工單轉 done 關單；被門禁攔了就把阻塞用例清單報給我。」',
          codes: ['spms_create_test_case (category=functional, issueId)', 'spms_run_test_suite (category=functional) → spms_update_issue (done / force)'],
        },
        {
          title: '版本部署 · 冒煙 + 上線前整合',
          when: '時機：每次部署後立即冒煙；版本全部開發完、轉「已發佈」之前跑整合測試——integration 用例全過才放行。',
          prompt: '「專案 X 剛部署完，跑冒煙套件，note 寫 v1.2.0 部署後冒煙。」「版本 V 準備發佈：執行整合測試並記錄，全部 passed 後把版本轉已發佈；被攔就列出沒過的用例。」',
          codes: ['spms_run_test_suite (category=smoke, projectId)', 'spms_run_test_suite (category=integration, releaseId) → spms_update_release (released / force)'],
        },
        {
          title: 'hotfix · 回歸',
          when: '時機：hotfix 修復部署後，驗證既有功能無退化；失敗的用例可直接轉成 BUG 工單繼續跟蹤。',
          prompt: '「hotfix 已部署，對專案 X 跑回歸套件，failed 的用例 raiseBugs=true 自動建 BUG，最後把執行匯總和新建的 BUG key 給我。」',
          codes: ['spms_run_test_suite (category=regression, raiseBugs=true)', 'spms_list_test_runs（執行歷史）'],
        },
      ],
    },
    footer:
      '本頁是推薦流程。除兩處測試門禁（工單關單看 functional 用例、版本發佈看 integration 用例，均可 force 覆蓋）外，SPMS 不按這九步攔截任何操作。這裡寫的是團隊約定的做法，遇到例外按實際情況來。',
  },
};
