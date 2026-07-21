/**
 * Seed script — run with: npm run db:seed
 *
 * Idempotent. Ensures, in order:
 *   1. the default company (key DEFAULT) — all pre-multi-company data was
 *      backfilled into it by migration 0001;
 *   2. AI agent members + the `ai` label, seeded PER COMPANY;
 *   3. company_admin memberships for platform admin users;
 *   4. the default role-permission matrix (company_admin excluded by design);
 *   5. the env MCP_API_KEY migrated into mcp_api_keys as a platform-level key
 *      (sha256 hash only; companyId NULL = platform scope);
 *   6. the admin user + demo dataset — first run only (skipped when the
 *      default company already has the CORE product line);
 *   7. a second, empty demo company (示例公司) to prove sandbox isolation.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

// Load .env.local / .env (Next only auto-loads these for `next` commands).
for (const file of ['.env.local', '.env']) {
  const p = resolve(process.cwd(), file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, v] = m;
    if (process.env[k] === undefined) process.env[k] = v.replace(/^["']|["']$/g, '');
  }
}

const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';

/* Default per-module access matrix for the configurable company roles.
   company_admin is implicit full access and intentionally not seeded. */
const ROLE_PERMISSION_MATRIX: { role: string; module: string; level: string }[] = [
  ...['issues', 'products', 'requirements', 'projects', 'resources', 'roadmap', 'backlog'].map(
    (module) => ({ role: 'product_manager', module, level: 'write' }),
  ),
  ...['testcases', 'sprints', 'agents'].map((module) => ({ role: 'product_manager', module, level: 'read' })),
  ...['issues', 'backlog', 'sprints'].map((module) => ({ role: 'developer', module, level: 'write' })),
  ...['products', 'requirements', 'testcases', 'projects', 'resources', 'roadmap', 'agents'].map(
    (module) => ({ role: 'developer', module, level: 'read' }),
  ),
  ...['issues', 'testcases'].map((module) => ({ role: 'tester', module, level: 'write' })),
  ...['products', 'requirements', 'projects', 'resources', 'roadmap', 'backlog', 'sprints'].map(
    (module) => ({ role: 'tester', module, level: 'read' }),
  ),
  { role: 'tester', module: 'agents', level: 'none' },
  ...['issues', 'products', 'requirements', 'projects', 'resources', 'roadmap', 'backlog', 'testcases', 'sprints', 'agents'].map(
    (module) => ({ role: 'viewer', module, level: 'read' }),
  ),
];

async function main() {
  const { db } = await import('../src/db');
  const {
    users,
    companies,
    companyMemberships,
    rolePermissions,
    mcpApiKeys,
    members,
    labels,
    productLines,
    products,
    releases,
    projects,
    sprints,
    requirements,
    issues,
    testCases,
  } = await import('../src/db/schema');
  const { nextKey } = await import('../src/lib/keys');
  const { hashPassword } = await import('../src/lib/password');

  const id = () => randomUUID();

  /* ---- 1. default company (idempotent) ---- */
  await db
    .insert(companies)
    .values({
      id: DEFAULT_COMPANY_ID,
      key: 'DEFAULT',
      name: '默认公司',
      color: '#0063D3',
      description: '系统默认公司：单公司时代的历史数据归属',
    })
    .onConflictDoNothing();
  console.log('company: DEFAULT (默认公司) ensured');

  /* ---- 2. AI agents + "AI 生成" label, seeded per company ---- */
  const AGENT_DEFS = [
    { agentKey: 'atlas', name: 'Atlas', initials: 'A', role: 'plan' },
    { agentKey: 'forge', name: 'Forge', initials: 'F', role: 'code' },
    { agentKey: 'sentry', name: 'Sentry', initials: 'S', role: 'test' },
    { agentKey: 'scribe', name: 'Scribe', initials: 'C', role: 'docs' },
  ] as const;

  async function seedAgents(companyId: string) {
    await db
      .insert(members)
      .values(
        AGENT_DEFS.map((a) => ({
          id: id(),
          companyId,
          type: 'agent' as const,
          name: a.name,
          initials: a.initials,
          color: null,
          role: a.role,
          userId: null,
          agentKey: a.agentKey,
        })),
      )
      .onConflictDoNothing();
    const agentRows = await db
      .select()
      .from(members)
      .where(and(eq(members.companyId, companyId), eq(members.type, 'agent')));
    return new Map(agentRows.map((m) => [m.agentKey, m.id]));
  }

  async function seedAiLabel(companyId: string) {
    await db
      .insert(labels)
      .values({ id: id(), companyId, key: 'ai', name: 'AI 生成', color: '#FF6B02' })
      .onConflictDoNothing();
  }

  const agentByKey = await seedAgents(DEFAULT_COMPANY_ID);
  await seedAiLabel(DEFAULT_COMPANY_ID);
  console.log(`agents + ai label ensured for default company (${AGENT_DEFS.map((a) => a.agentKey).join(', ')})`);

  /* ---- 3. platform admins → company_admin of the default company ---- */
  const adminUsers = await db.select().from(users).where(eq(users.role, 'admin'));
  for (const u of adminUsers) {
    await db
      .insert(companyMemberships)
      .values({ id: id(), userId: u.id, companyId: DEFAULT_COMPANY_ID, role: 'company_admin' })
      .onConflictDoNothing();
  }
  if (adminUsers.length > 0) console.log(`membership: ${adminUsers.length} admin user(s) ensured as company_admin`);

  /* ---- 4. default role-permission matrix (idempotent) ---- */
  await db.insert(rolePermissions).values(ROLE_PERMISSION_MATRIX).onConflictDoNothing();
  console.log(`role_permissions: default matrix ensured (${ROLE_PERMISSION_MATRIX.length} rows)`);

  /* ---- 5. env MCP_API_KEY → mcp_api_keys (platform-level, idempotent) ---- */
  const envMcpKey = process.env.MCP_API_KEY;
  if (envMcpKey) {
    const keyHash = createHash('sha256').update(envMcpKey).digest('hex');
    await db
      .insert(mcpApiKeys)
      .values({
        id: id(),
        keyHash,
        prefix: envMcpKey.slice(0, 8),
        name: 'env-migrated',
        companyId: null, // NULL = platform-level key
        createdBy: adminUsers[0]?.id ?? null,
      })
      .onConflictDoNothing();
    console.log('mcp_api_keys: env MCP_API_KEY migrated as platform-level key (env-migrated)');
  } else {
    console.log('mcp_api_keys: MCP_API_KEY not set — skipped env key migration');
  }

  /* ---- 6. admin user + demo data (first run only) ---- */
  const [existingLine] = await db
    .select()
    .from(productLines)
    .where(and(eq(productLines.companyId, DEFAULT_COMPANY_ID), eq(productLines.key, 'CORE')))
    .limit(1);
  if (existingLine) {
    console.log('demo data already present (CORE product line exists) — skipped (seed is idempotent).');
  } else {
    const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123';
    await db
      .insert(users)
      .values({
        id: id(),
        username: 'admin',
        passwordHash: await hashPassword(adminPassword),
        name: '管理员',
        role: 'admin',
      })
      .onConflictDoNothing();
    const [adminUser] = await db.select().from(users).where(eq(users.username, 'admin')).limit(1);
    await db
      .insert(companyMemberships)
      .values({ id: id(), userId: adminUser.id, companyId: DEFAULT_COMPANY_ID, role: 'company_admin' })
      .onConflictDoNothing();
    console.log(`user: admin created (password from ${process.env.SEED_ADMIN_PASSWORD ? 'SEED_ADMIN_PASSWORD' : 'default admin123'})`);

    /* ---- demo data: 产品线 → 产品 → 版本 → 项目 → 迭代 → issues/需求/用例 ---- */
    const companyId = DEFAULT_COMPANY_ID;
    const [line] = await db
      .insert(productLines)
      .values({ id: id(), companyId, key: 'CORE', name: '核心产品线', description: '公司核心产品所在的产品线' })
      .returning();

    const [product] = await db
      .insert(products)
      .values({
        id: id(),
        companyId,
        productLineId: line.id,
        key: 'SPMS',
        name: 'SPMS 研发管理平台',
        description: '面向研发团队的 issue / 迭代 / 需求管理工具',
      })
      .returning();

    const [release] = await db
      .insert(releases)
      .values({
        id: id(),
        companyId,
        productId: product.id,
        key: 'V1.0',
        name: 'v1.0',
        description: '首个可用版本：项目管理 + 迭代 + issue 全流程',
        status: 'in_progress',
        phase: 'development',
        targetDate: new Date(Date.now() + 30 * 86400_000),
      })
      .returning();

    const [project] = await db
      .insert(projects)
      .values({
        id: id(),
        companyId,
        name: 'SPMS Next.js 重写',
        releaseId: release.id,
        status: 'in_progress',
        aiLeadId: agentByKey.get('atlas') ?? null,
        target: '用 Next.js 重写 spms-server，交付同构的研发管理后台',
        summary: '将 Bun+Elysia 后端迁移为 Next.js 全栈应用',
        goal: 'API 兼容现有契约；数据库层去多租户化',
        nonGoals: '不改业务语义；不引入新的产品功能',
      })
      .returning();

    const now = Date.now();
    const [sprintActive, sprintPlanned] = await db
      .insert(sprints)
      .values([
        {
          id: id(),
          companyId,
          projectId: project.id,
          name: 'Sprint 1',
          goal: '打通脚手架 + 数据库层 + 登录',
          status: 'active' as const,
          startDate: new Date(now - 7 * 86400_000),
          endDate: new Date(now + 7 * 86400_000),
          capacity: 40,
        },
        {
          id: id(),
          companyId,
          projectId: project.id,
          name: 'Sprint 2',
          goal: 'issue / 迭代 API 与页面',
          status: 'planned' as const,
          startDate: new Date(now + 8 * 86400_000),
          endDate: new Date(now + 21 * 86400_000),
          capacity: 40,
        },
      ])
      .returning();

    /* ---- requirements (FR / NFR) ---- */
    const [fr, nfr] = await db
      .insert(requirements)
      .values([
        {
          id: id(),
          companyId,
          key: await nextKey(companyId, 'FR'),
          projectId: project.id,
          releaseId: release.id,
          title: '用户可以用账号密码登录',
          type: 'functional' as const,
          priority: 'high' as const,
          importance: 'high' as const,
          status: 'approved' as const,
          description: '本地账号体系：用户名 + 密码登录，会话用签名 token 维持。',
          acceptanceCriteria: '正确账号密码登录成功并跳转首页；错误密码返回明确提示。',
          aiOwnerId: agentByKey.get('atlas') ?? null,
        },
        {
          id: id(),
          companyId,
          key: await nextKey(companyId, 'NFR'),
          projectId: project.id,
          releaseId: release.id,
          title: '核心列表 API p95 延迟 < 300ms',
          type: 'non_functional' as const,
          category: 'performance' as const,
          priority: 'medium' as const,
          importance: 'medium' as const,
          status: 'reviewing' as const,
          description: 'issue 列表、项目列表等核心只读接口在演示数据规模下 p95 < 300ms。',
          acceptanceCriteria: '本地压测 100 并发下 p95 < 300ms。',
          aiOwnerId: agentByKey.get('atlas') ?? null,
        },
      ])
      .returning();

    /* ---- issues: bug / ticket / backlog ---- */
    const forge = agentByKey.get('forge') ?? null;
    const sentry = agentByKey.get('sentry') ?? null;
    type IssueInsert = typeof issues.$inferInsert;
    const issueData: Omit<IssueInsert, 'id' | 'companyId'>[] = [
      // bugs
      { key: await nextKey(companyId, 'BUG'), title: '登录页密码错误提示不消失', type: 'bug', status: 'in_progress', priority: 'urgent', storyPoints: 3, projectId: project.id, sprintId: sprintActive.id, requirementId: fr.id, assigneeId: forge, aiAssigned: true },
      { key: await nextKey(companyId, 'BUG'), title: 'issue 列表分页偶发重复', type: 'bug', status: 'todo', priority: 'high', storyPoints: 2, projectId: project.id, sprintId: sprintActive.id, assigneeId: forge, aiAssigned: true },
      { key: await nextKey(companyId, 'BUG'), title: '看板拖拽在 Safari 上卡顿', type: 'bug', status: 'backlog', priority: 'medium', storyPoints: 5, projectId: project.id },
      // tickets
      { key: await nextKey(companyId, 'TKT'), title: '搭建 Next.js 脚手架与数据库层', type: 'ticket', status: 'done', priority: 'high', storyPoints: 5, projectId: project.id },
      { key: await nextKey(companyId, 'TKT'), title: '实现 issue 列表 / 详情 API', type: 'ticket', status: 'in_progress', priority: 'high', storyPoints: 5, projectId: project.id, sprintId: sprintActive.id, requirementId: fr.id },
      { key: await nextKey(companyId, 'TKT'), title: '成员管理页设计与联调', type: 'ticket', status: 'todo', priority: 'medium', storyPoints: 3, projectId: project.id, sprintId: sprintPlanned.id },
      // backlog items
      { key: await nextKey(companyId, 'BLG'), title: '支持甘特图视图', type: 'backlog', status: 'backlog', priority: 'low', storyPoints: 8, projectId: project.id },
      { key: await nextKey(companyId, 'BLG'), title: '迭代报表导出 CSV', type: 'backlog', status: 'backlog', priority: 'none', projectId: project.id },
    ];
    const issueRows: IssueInsert[] = issueData.map((r) => ({ id: id(), companyId, ...r }));
    await db.insert(issues).values(issueRows);

    /* ---- test cases ---- */
    await db.insert(testCases).values([
      {
        id: id(),
        companyId,
        key: await nextKey(companyId, 'TC'),
        projectId: project.id,
        requirementId: fr.id,
        title: '正确账号密码登录成功',
        priority: 'high',
        status: 'active',
        result: 'passed',
        preconditions: '已存在 admin 账号',
        steps: '1. 打开登录页\n2. 输入 admin / 正确密码\n3. 点击登录',
        expected: '登录成功并跳转首页',
        assigneeId: sentry,
      },
      {
        id: id(),
        companyId,
        key: await nextKey(companyId, 'TC'),
        projectId: project.id,
        requirementId: fr.id,
        title: '错误密码登录失败',
        priority: 'medium',
        status: 'draft',
        result: 'untested',
        preconditions: '已存在 admin 账号',
        steps: '1. 打开登录页\n2. 输入 admin / 错误密码\n3. 点击登录',
        expected: '返回 401 并提示密码错误',
        assigneeId: sentry,
      },
    ]);

    console.log('demo data: 1 product line / 1 product / 1 release / 1 project / 2 sprints');
    console.log(`demo data: 2 requirements, ${issueRows.length} issues, 2 test cases`);
  }

  /* ---- 7. second demo company (empty, proves sandbox isolation) ---- */
  await db
    .insert(companies)
    .values({
      id: id(),
      key: 'SAMPLE',
      name: '示例公司',
      color: '#00A86B',
      description: '演示用空公司：无任何业务数据，用于验证公司间数据隔离',
    })
    .onConflictDoNothing();
  const [sampleCompany] = await db.select().from(companies).where(eq(companies.key, 'SAMPLE')).limit(1);
  for (const u of adminUsers) {
    await db
      .insert(companyMemberships)
      .values({ id: id(), userId: u.id, companyId: sampleCompany.id, role: 'company_admin' })
      .onConflictDoNothing();
  }
  console.log('company: SAMPLE (示例公司) ensured — empty sandbox, admin membership granted');

  console.log('seed done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
