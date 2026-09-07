import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { companyMemberships, members, resourceAssignments } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import * as issueSvc from '@/server/services/issues';
import * as requirementSvc from '@/server/services/requirements';
import type { Actor } from '@/server/services/types';

/* MCP 工作流驱动（TKT-6）：把「功能审查 → 状态流转 → 自动化指派」内置进 MCP
   工具处理，无需调用方显式提示词。状态/评论落库一律走现有 service 层
   （issues.ts / requirements.ts），保证活动流记录与 REST/UI 一致。

   规则：
   1) 处理任何 issue/需求前必须先经 spms_review_issue 完成功能审查
      （工单审查是否已实现，BUG 审查是否可复现）；
   2) 审查通过 → issue 自动置 in_progress（需求置 in_dev）；
   3) 开发完成（update_issue 传 status='done' 或审查结论 already_done）→
      自动置 testing 并指派测试人员（优先当前项目的测试人员，回退 AI 测试员工）。 */

export type ReviewVerdict = 'passed' | 'failed' | 'already_done';

/* 默认测试人员查找（BUG-15），按优先级：
   1) 当前项目的测试人员 —— 项目资源池（resourceAssignments）中、本公司席位角色
      为 tester 的 active 人类成员（assignment lead 优先，再按姓名）；
   2) 项目没有测试人员（或 issue 不属于任何项目）→ 回退 AI 测试员工：
      type='agent'、role='test'、status='active' 的第一个成员（内置即 Sentry）。
   都找不到返回 null —— 不阻塞流程，由调用方在结果中说明。 */
export async function findTester(companyId: string, projectId?: string | null) {
  if (projectId) {
    const [human] = await db
      .select({ id: members.id, name: members.name })
      .from(resourceAssignments)
      .innerJoin(members, and(eq(members.companyId, companyId), eq(members.id, resourceAssignments.memberId)))
      .innerJoin(
        companyMemberships,
        and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.userId, members.userId)),
      )
      .where(
        and(
          eq(resourceAssignments.companyId, companyId),
          eq(resourceAssignments.nodeType, 'project'),
          eq(resourceAssignments.nodeId, projectId),
          eq(members.type, 'human'),
          eq(members.status, 'active'),
          eq(companyMemberships.role, 'tester'),
        ),
      )
      // assignment_role 枚举升序即 'lead' 排在 'member' 前。
      .orderBy(asc(resourceAssignments.role), asc(members.name))
      .limit(1);
    if (human) return human;
  }
  const [m] = await db
    .select({ id: members.id, name: members.name })
    .from(members)
    .where(
      and(eq(members.companyId, companyId), eq(members.type, 'agent'), eq(members.role, 'test'), eq(members.status, 'active')),
    )
    .orderBy(asc(members.agentKey))
    .limit(1);
  return m ?? null;
}

/* spms_update_issue 的工作流包装：
   - status='done' → 拦截，实际落库 'testing'（开发完成不直接关单，需测试验证）；
     未显式传 assigneeId 时自动指派测试人员；并自动写一条说明评论。
   - status='testing' 且未显式传 assigneeId → 自动指派测试人员。
   - 其余入参原样透传。 */
export async function updateIssueWithWorkflow(actor: Actor, key: string, input: issueSvc.UpdateIssueInput) {
  if (input.status === 'done') {
    const current = input.assigneeId === undefined ? await issueSvc.getIssue(actor, key) : null;
    const tester = input.assigneeId === undefined ? await findTester(actor.companyId, current?.projectId) : null;
    const issue = await issueSvc.updateIssue(actor, key, {
      ...input,
      status: 'testing',
      ...(tester ? { assigneeId: tester.id } : {}),
    });
    await issueSvc.addComment(
      actor,
      key,
      tester
        ? `已完成开发，自动流转待测试（testing）并指派测试人员 ${tester.name}。`
        : input.assigneeId === undefined
          ? '已完成开发，自动流转待测试（testing）；未找到可用的测试人员（项目测试成员或 agent 成员中 role=test），请手动指派。'
          : '已完成开发，自动流转待测试（testing）。',
    );
    return issue;
  }
  if (input.status === 'testing' && input.assigneeId === undefined) {
    const current = await issueSvc.getIssue(actor, key);
    const tester = await findTester(actor.companyId, current?.projectId);
    if (tester) return issueSvc.updateIssue(actor, key, { ...input, assigneeId: tester.id });
  }
  return issueSvc.updateIssue(actor, key, input);
}

/* spms_review_issue：功能审查驱动。key 前缀 FR-/NFR- 按需求处理，其余按
   issue（TKT/BUG/BLG 或自定义 key）处理。note 写为 issue 评论（需求无评论
   能力，note 不落库，在返回 message 中说明）。 */
export async function reviewWithWorkflow(actor: Actor, key: string, verdict: ReviewVerdict, note?: string) {
  if (/^(FR|NFR)-/.test(key)) return reviewRequirement(actor, key, verdict, note);
  return reviewIssue(actor, key, verdict, note);
}

async function reviewIssue(actor: Actor, key: string, verdict: ReviewVerdict, note?: string) {
  const before = await issueSvc.getIssue(actor, key);
  if (!before) throw new ApiException('ISSUE_NOT_FOUND', `Issue ${key} 不存在`);
  const isBug = before.type === 'bug';
  const noteSuffix = note?.trim() ? `\n${note.trim()}` : '';

  if (verdict === 'failed') {
    // 审查未通过（如 BUG 不可复现）：只写评论、状态不变，返回后续建议。
    const comment = `【功能审查】未通过：${isBug ? '缺陷不可复现' : '工单审查未通过'}。${noteSuffix}`;
    await issueSvc.addComment(actor, key, comment);
    return {
      key,
      target: 'issue',
      verdict,
      status: { before: before.status, after: before.status },
      autoAssignee: null,
      comment,
      suggestion: isBug
        ? '缺陷不可复现：建议补充复现步骤/环境信息后重新审查，或与报告人确认；确认非缺陷可将 status 置为 canceled。'
        : '审查未通过：建议补充或修正描述后重新审查。',
      issue: before,
    };
  }

  if (verdict === 'passed') {
    // 审查通过（工单未实现需开发 / BUG 可复现需修复）→ 自动置 in_progress。
    const issue = await issueSvc.updateIssue(actor, key, { status: 'in_progress' });
    const comment = `【功能审查】通过：${isBug ? '缺陷可复现，转入修复' : '工单尚未实现，转入开发'}。${noteSuffix}`;
    await issueSvc.addComment(actor, key, comment);
    return {
      key,
      target: 'issue',
      verdict,
      status: { before: before.status, after: 'in_progress' },
      autoAssignee: null,
      comment,
      issue,
    };
  }

  // already_done（工单已实现 / 无需修改）→ 自动置 testing 并指派测试人员。
  const tester = await findTester(actor.companyId, before.projectId);
  const issue = await issueSvc.updateIssue(actor, key, {
    status: 'testing',
    ...(tester ? { assigneeId: tester.id } : {}),
  });
  const comment =
    `【功能审查】已实现/无需修改，自动流转待测试（testing）` +
    (tester ? `并指派测试人员 ${tester.name}。` : '；未找到可用的测试人员（项目测试成员或 agent 成员中 role=test），请手动指派。') +
    noteSuffix;
  await issueSvc.addComment(actor, key, comment);
  return {
    key,
    target: 'issue',
    verdict,
    status: { before: before.status, after: 'testing' },
    autoAssignee: tester,
    comment,
    issue,
  };
}

async function reviewRequirement(actor: Actor, key: string, verdict: ReviewVerdict, note?: string) {
  const before = await requirementSvc.getRequirement(actor, key);
  if (!before) throw new ApiException('REQUIREMENT_NOT_FOUND', `需求 ${key} 不存在`);
  void note; // 需求无评论能力，note 不落库。

  if (verdict === 'passed') {
    // 需求池中的需求同样处理：审查通过 → 自动置 in_dev。
    const requirement = await requirementSvc.updateRequirement(actor, key, { status: 'in_dev' });
    return {
      key,
      target: 'requirement',
      verdict,
      status: { before: before.status, after: 'in_dev' },
      autoAssignee: null,
      comment: null,
      message: '需求审查通过，状态已自动置为 in_dev（需求无评论能力，note 未落库）。',
      requirement,
    };
  }
  return {
    key,
    target: 'requirement',
    verdict,
    status: { before: before.status, after: before.status },
    autoAssignee: null,
    comment: null,
    message: '审查结论非 passed：需求状态保持不变（需求无评论能力，note 未落库）。',
    requirement: before,
  };
}
