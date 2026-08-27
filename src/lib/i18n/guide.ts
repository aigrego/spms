import type { Locale } from '@/lib/i18n';

/* 生命周期指引(/guide,TKT-68)的长文案内容。长文案不走 t() 词典(见
   i18n/plans.ts 注释),按 Locale 存结构化数据,页面组件直接渲染。 */

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
          '拆得出条目的进需求池，成为 FR / NFR；拆不出条目的七段（概述、背景、用户与场景、目标、非目标、约束与前提、开放问题）填进「项目 → 基本信息」。Agent 负责产出，写库前必须人工确认：创建接口不幂等，重复调用就会造出重复需求。',
        ],
        codes: ['npx skills add XGENT-ai/skills --skill prd'],
        link: { label: '打开需求池', href: '/requirements' },
      },
      {
        letter: 'd',
        title: '把需求拆解为工单',
        badges: ['human'],
        owner: '产品负责人 / 执行 PM',
        body: [
          '在需求详情点「拆解为工单」，一次批量建出 TKT 并指派到人，一次 1 到 20 条、key 连号。首个工单开工时，需求会自动转为开发中。',
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
          '进入迭代的工单由 Agent 按复杂度评估故事点（1/2/3/5/8），拖入迭代时自动补齐，人工可随时覆盖。故事点只做容量参考，不做绩效依据。',
        ],
      },
      {
        letter: 'g',
        title: '出开发计划，补测试用例',
        badges: ['agent'],
        owner: '开发人员 / 测试人员',
        body: [
          '一份计划可以覆盖多条需求，一条需求也可以拆给多份计划，关联键是 FR / NFR key 而不是文件名。开发计划在「项目 → 开发计划」tab；测试用例要覆盖正常、边界、权限、并发四类。',
        ],
        codes: [
          'npx skills add XGENT-ai/skills --skill dev-plan',
          'npx skills add XGENT-ai/skills --skill test-plan',
        ],
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
        title: '第二道验收：全部工单完成后，把需求转「已上线」',
        badges: ['human'],
        owner: '需求作者与负责人',
        body: [
          '需求名下的工单全部完成后，需求详情会出现「全部工单已完成 → 转已上线」的提示条。需求侧没有「已上线」之后的第二个终态：点这一下就是需求级验收。系统绝不自动改状态。',
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
          'Whatever decomposes into items goes into the requirement pool as FRs / NFRs; the seven sections that do not decompose (overview, background, users & scenarios, goals, non-goals, constraints & assumptions, open questions) go into "Project → Basic info". The Agent produces the draft, but a human must confirm before anything is written: the create API is not idempotent — call it twice and you get duplicate requirements.',
        ],
        codes: ['npx skills add XGENT-ai/skills --skill prd'],
        link: { label: 'Open Requirement Pool', href: '/requirements' },
      },
      {
        letter: 'd',
        title: 'Break requirements down into tickets',
        badges: ['human'],
        owner: 'Product Owner / Executing PM',
        body: [
          'Click "Decompose into tickets" on the requirement detail to batch-create TKTs assigned to people — 1 to 20 at a time, with consecutive keys. When the first ticket starts, the requirement automatically moves to In Dev.',
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
          'Tickets entering a sprint get story points (1/2/3/5/8) from the Agent based on complexity, filled in automatically when dragged into the sprint; humans can override at any time. Story points are a capacity reference, not a performance metric.',
        ],
      },
      {
        letter: 'g',
        title: 'Produce the dev plan, backfill test cases',
        badges: ['agent'],
        owner: 'Developer / Tester',
        body: [
          'One plan can cover several requirements, and one requirement can be split across several plans — the link key is the FR / NFR key, not a file name. Dev plans live in the "Project → Dev Plans" tab. Test cases must cover four classes: happy path, boundary, permission, and concurrency.',
        ],
        codes: [
          'npx skills add XGENT-ai/skills --skill dev-plan',
          'npx skills add XGENT-ai/skills --skill test-plan',
        ],
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
        title: 'Second acceptance: once all tickets are done, mark the requirement "Shipped"',
        badges: ['human'],
        owner: 'Requirement author and owner',
        body: [
          'When every ticket under a requirement is done, a banner "All tickets done → mark as shipped" appears on the requirement detail. There is no second terminal state after "Shipped": that one click IS the requirement-level acceptance. The system never changes status on its own.',
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
          '拆得出條目的進需求池，成為 FR / NFR；拆不出條目的七段（概述、背景、使用者與場景、目標、非目標、約束與前提、開放問題）填進「專案 → 基本資訊」。Agent 負責產出，寫庫前必須人工確認：建立介面不冪等，重複呼叫就會造出重複需求。',
        ],
        codes: ['npx skills add XGENT-ai/skills --skill prd'],
        link: { label: '打開需求池', href: '/requirements' },
      },
      {
        letter: 'd',
        title: '把需求拆解為工單',
        badges: ['human'],
        owner: '產品負責人 / 執行 PM',
        body: [
          '在需求詳情點「拆解為工單」，一次批次建出 TKT 並指派到人，一次 1 到 20 條、key 連號。首個工單開工時，需求會自動轉為開發中。',
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
          '進入迭代的工單由 Agent 按複雜度評估故事點（1/2/3/5/8），拖入迭代時自動補齊，人工可隨時覆蓋。故事點只做容量參考，不做績效依據。',
        ],
      },
      {
        letter: 'g',
        title: '出開發計劃，補測試用例',
        badges: ['agent'],
        owner: '開發人員 / 測試人員',
        body: [
          '一份計劃可以覆蓋多條需求，一條需求也可以拆給多份計劃，關聯鍵是 FR / NFR key 而不是檔名。開發計劃在「專案 → 開發計劃」tab；測試用例要覆蓋正常、邊界、權限、並發四類。',
        ],
        codes: [
          'npx skills add XGENT-ai/skills --skill dev-plan',
          'npx skills add XGENT-ai/skills --skill test-plan',
        ],
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
        title: '第二道驗收：全部工單完成後，把需求轉「已上線」',
        badges: ['human'],
        owner: '需求作者與負責人',
        body: [
          '需求名下的工單全部完成後，需求詳情會出現「全部工單已完成 → 轉已上線」的提示條。需求側沒有「已上線」之後的第二個終態：點這一下就是需求級驗收。系統絕不自動改狀態。',
        ],
        link: { label: '打開需求池', href: '/requirements' },
      },
    ],
    footer:
      '本頁是推薦流程，不是強制校驗。SPMS 不會按這九步攔截任何操作，狀態仍可自由流轉。這裡寫的是團隊約定的做法，遇到例外按實際情況來。',
  },
};
