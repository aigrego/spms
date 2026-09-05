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

export interface GuideContent {
  title: string;
  subtitle: string;
  badgeHuman: string;
  badgeAgent: string;
  steps: GuideStep[];
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
        title: '建 Sprint，把需求和 Issue 拖进迭代',
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
        ],
        codes: ['MCP: spms_create_plan → spms_update_plan', 'MCP: spms_create_test_case'],
        link: { label: '打开测试用例', href: '/testcases' },
      },
      {
        letter: 'h',
        title: '第一道验收：工单走完交付链，提出人验收转完成',
        badges: ['human'],
        owner: '开发人员（转）+ 提出人（验）',
        body: [
          '开发按实际进展推状态：开工转「进行中」，开发完成转「待测试」（系统自动指派测试人员，提出人验收）。提出人验过了才转「已完成」。状态由人写，系统不替谁宣称。',
        ],
        link: { label: '打开我的 Issues', href: '/my-issues' },
      },
      {
        letter: 'i',
        title: '第二道验收：全部工单完成后，把需求转「已完成」',
        badges: ['human'],
        owner: '需求作者与负责人',
        body: [
          '需求名下的工单全部完成后，由需求作者或负责人在需求详情手动把状态转为「已完成」（经「待测试」验收）。「已完成」是需求侧的终态：点这一下就是需求级验收，系统绝不自动改状态。',
        ],
        link: { label: '打开需求池', href: '/requirements' },
      },
    ],
    footer:
      '本页是推荐流程，不是强制校验。SPMS 不会按这九步拦截任何操作，状态仍可自由流转。这里写的是团队约定的做法，遇到例外按实际情况来。',
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
        title: 'Create a Sprint and drag requirements and issues into it',
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
        ],
        codes: ['MCP: spms_create_plan → spms_update_plan', 'MCP: spms_create_test_case'],
        link: { label: 'Open Test Cases', href: '/testcases' },
      },
      {
        letter: 'h',
        title: 'First acceptance: tickets walk the delivery chain, the requester accepts',
        badges: ['human'],
        owner: 'Developer (hands over) + Requester (accepts)',
        body: [
          'Developers move status with real progress: starting work moves a ticket to "In Progress"; finishing development moves it to "Testing" (the system auto-assigns a tester, and the requester accepts). Only after the requester accepts does it move to "Done". Status is written by people — the system claims nothing on anyone\u2019s behalf.',
        ],
        link: { label: 'Open My Issues', href: '/my-issues' },
      },
      {
        letter: 'i',
        title: 'Second acceptance: once all tickets are done, mark the requirement "Done"',
        badges: ['human'],
        owner: 'Requirement author and owner',
        body: [
          'When every ticket under a requirement is done, the requirement author or owner manually moves it to "Done" on the requirement detail (accepted via "Ready for Testing"). "Done" is the terminal state on the requirement side: that one click IS the requirement-level acceptance — the system never changes status on its own.',
        ],
        link: { label: 'Open Requirement Pool', href: '/requirements' },
      },
    ],
    footer:
      'This page is a recommended workflow, not an enforced one. SPMS does not block any operation based on these nine steps, and statuses can still flow freely. It records the team\u2019s agreed practice — handle exceptions case by case.',
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
        title: '建 Sprint，把需求和 Issue 拖進迭代',
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
        ],
        codes: ['MCP: spms_create_plan → spms_update_plan', 'MCP: spms_create_test_case'],
        link: { label: '打開測試用例', href: '/testcases' },
      },
      {
        letter: 'h',
        title: '第一道驗收：工單走完交付鏈，提出人驗收轉完成',
        badges: ['human'],
        owner: '開發人員（轉）+ 提出人（驗）',
        body: [
          '開發按實際進展推狀態：開工轉「進行中」，開發完成轉「待測試」（系統自動指派測試人員，提出人驗收）。提出人驗過了才轉「已完成」。狀態由人寫，系統不替誰宣稱。',
        ],
        link: { label: '打開我的 Issues', href: '/my-issues' },
      },
      {
        letter: 'i',
        title: '第二道驗收：全部工單完成後，把需求轉「已完成」',
        badges: ['human'],
        owner: '需求作者與負責人',
        body: [
          '需求名下的工單全部完成後，由需求作者或負責人在需求詳情手動把狀態轉為「已完成」（經「待測試」驗收）。「已完成」是需求側的終態：點這一下就是需求級驗收，系統絕不自動改狀態。',
        ],
        link: { label: '打開需求池', href: '/requirements' },
      },
    ],
    footer:
      '本頁是推薦流程，不是強制校驗。SPMS 不會按這九步攔截任何操作，狀態仍可自由流轉。這裡寫的是團隊約定的做法，遇到例外按實際情況來。',
  },
};
