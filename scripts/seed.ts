/**
 * Seed script — run with: npm run db:seed
 *
 * Idempotent: the admin user, AI agents and the `ai` label are upserted
 * (onConflictDoNothing); the demo dataset is only inserted on first run
 * (skipped when the admin user already exists).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

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

async function main() {
  const { db } = await import('../src/db');
  const {
    users,
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

  /* ---- AI agent members (idempotent) ---- */
  const AGENT_DEFS = [
    { agentKey: 'atlas', name: 'Atlas', initials: 'A', role: 'plan' },
    { agentKey: 'forge', name: 'Forge', initials: 'F', role: 'code' },
    { agentKey: 'sentry', name: 'Sentry', initials: 'S', role: 'test' },
    { agentKey: 'scribe', name: 'Scribe', initials: 'C', role: 'docs' },
  ] as const;
  await db
    .insert(members)
    .values(
      AGENT_DEFS.map((a) => ({
        id: id(),
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
  const agentRows = await db.select().from(members).where(eq(members.type, 'agent'));
  const agentByKey = new Map(agentRows.map((m) => [m.agentKey, m.id]));
  console.log(`agents: ${agentRows.length} present (${AGENT_DEFS.map((a) => a.agentKey).join(', ')})`);

  /* ---- "AI 生成" label (idempotent) ---- */
  await db
    .insert(labels)
    .values({ id: id(), key: 'ai', name: 'AI 生成', color: '#FF6B02' })
    .onConflictDoNothing();
  console.log('label: ai (AI 生成) ensured');

  /* ---- admin user + demo data (first run only) ---- */
  const [existingAdmin] = await db.select().from(users).where(eq(users.username, 'admin')).limit(1);
  if (existingAdmin) {
    console.log('admin user already exists — skipping demo data (seed is idempotent).');
    process.exit(0);
  }

  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  await db.insert(users).values({
    id: id(),
    username: 'admin',
    passwordHash: await hashPassword(adminPassword),
    name: '管理员',
    role: 'admin',
  });
  console.log(`user: admin created (password from ${process.env.SEED_ADMIN_PASSWORD ? 'SEED_ADMIN_PASSWORD' : 'default admin123'})`);

  /* ---- demo data: 产品线 → 产品 → 版本 → 项目 → 迭代 → issues/需求/用例 ---- */
  const [line] = await db
    .insert(productLines)
    .values({ id: id(), key: 'CORE', name: '核心产品线', description: '公司核心产品所在的产品线' })
    .returning();

  const [product] = await db
    .insert(products)
    .values({
      id: id(),
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
        key: await nextKey('FR'),
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
        key: await nextKey('NFR'),
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
  const issueData: Omit<IssueInsert, 'id'>[] = [
    // bugs
    { key: await nextKey('BUG'), title: '登录页密码错误提示不消失', type: 'bug', status: 'in_progress', priority: 'urgent', storyPoints: 3, projectId: project.id, sprintId: sprintActive.id, requirementId: fr.id, assigneeId: forge, aiAssigned: true },
    { key: await nextKey('BUG'), title: 'issue 列表分页偶发重复', type: 'bug', status: 'todo', priority: 'high', storyPoints: 2, projectId: project.id, sprintId: sprintActive.id, assigneeId: forge, aiAssigned: true },
    { key: await nextKey('BUG'), title: '看板拖拽在 Safari 上卡顿', type: 'bug', status: 'backlog', priority: 'medium', storyPoints: 5, projectId: project.id },
    // tickets
    { key: await nextKey('TKT'), title: '搭建 Next.js 脚手架与数据库层', type: 'ticket', status: 'done', priority: 'high', storyPoints: 5, projectId: project.id },
    { key: await nextKey('TKT'), title: '实现 issue 列表 / 详情 API', type: 'ticket', status: 'in_progress', priority: 'high', storyPoints: 5, projectId: project.id, sprintId: sprintActive.id, requirementId: fr.id },
    { key: await nextKey('TKT'), title: '成员管理页设计与联调', type: 'ticket', status: 'todo', priority: 'medium', storyPoints: 3, projectId: project.id, sprintId: sprintPlanned.id },
    // backlog items
    { key: await nextKey('BLG'), title: '支持甘特图视图', type: 'backlog', status: 'backlog', priority: 'low', storyPoints: 8, projectId: project.id },
    { key: await nextKey('BLG'), title: '迭代报表导出 CSV', type: 'backlog', status: 'backlog', priority: 'none', projectId: project.id },
  ];
  const issueRows: IssueInsert[] = issueData.map((r) => ({ id: id(), ...r }));
  await db.insert(issues).values(issueRows);

  /* ---- test cases ---- */
  await db.insert(testCases).values([
    {
      id: id(),
      key: await nextKey('TC'),
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
      key: await nextKey('TC'),
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
  console.log('seed done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
