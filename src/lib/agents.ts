import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { activities, issues, issueLabels, members } from '@/db/schema';
import { ensureAiLabel } from './identity';

/* AI Agent event dispatch (PLAN-5 §4.6, confirmation #3: DEMO + RESERVED).
   Ported from apps/spms-server/src/lib/agents.ts + the onAgentAssigned flow in
   routes/issues.ts, with two rewrite changes:
     - SYNCHRONOUS: the scripted steps are all written in one call (no
       setTimeout — Next.js serverless/route-handler runtimes don't keep a
       process alive for timers).
     - portal notifications are dropped (no portal in the rewrite).

   This is the SINGLE extension point between "an issue was handed to an agent"
   and "the agent does work". The CONTRACT below is the seam a future real LLM
   worker subscribes to — the payload shape will not change. The CURRENT
   implementation only writes a scripted activity stream to reproduce the
   "AI Agent workspace · live steps" feel from PMS.md. There is NO real LLM here:
   no model call, no queue, no webhook table. Replacing this body with a real
   subscriber does not touch any caller. Do NOT imply a real model is running. */

export interface AgentTaskEvent {
  companyId: string; // companies.id — the sandbox this task runs in
  issueId: string; // internal uuid
  agentMemberId: string; // members.id of the assigned agent
  agentKey: string; // 'atlas' | 'forge' | 'sentry' | 'scribe' | …
  kind: 'assigned' | string;
  payload?: Record<string, unknown>;
}

// Scripted step text per agent role. Demo flavor only.
const SCRIPTS: Record<string, string[]> = {
  atlas: ['被指派 · Agent 已接管，开始拆解需求', '梳理验收标准与边界场景', '已更新 PRD 草稿并附到讨论区'],
  forge: ['被指派 · Agent 已接管，分析实现路径', '生成实现草稿与并发测试', '提交草稿 PR，等待评审'],
  sentry: ['被指派 · Agent 已接管，分析回归范围', '聚类历史运行日志生成回归用例', '回归用例集 v1 已就绪'],
  scribe: ['被指派 · Agent 已接管，收集变更点', '起草变更日志与使用文档', '文档草稿已生成，待确认'],
  default: ['被指派 · Agent 已接管，开始处理', '生成初步结果', '已产出草稿，等待评审'],
};

/* Fire the agent task: write every scripted step as an `ai` activity in one go
   (synchronous rewrite — the blueprint staggered them with setTimeout). The
   `kind` is part of the extension contract ('assigned' today) and does not
   change the demo behavior. */
export async function dispatchAgentTask(
  companyId: string,
  issueId: string,
  agentMemberId: string,
  kind: 'assigned' | string = 'assigned',
): Promise<void> {
  void kind;
  const [agent] = await db
    .select({ agentKey: members.agentKey })
    .from(members)
    .where(eq(members.id, agentMemberId))
    .limit(1);
  const steps = SCRIPTS[agent?.agentKey ?? 'default'] ?? SCRIPTS.default;
  if (!steps.length) return;
  await db.insert(activities).values(
    steps.map((body) => ({
      id: crypto.randomUUID(),
      companyId,
      issueId,
      whoId: agentMemberId,
      kind: 'ai' as const,
      body,
    })),
  );
  await db.update(issues).set({ updatedAt: new Date() }).where(eq(issues.id, issueId));
}

/* When an issue is assigned to an agent: attach the AI label and fire the
   (demo, synchronous) agent task. The blueprint also sent a portal
   notification — dropped in the rewrite (no portal). */
export async function onAgentAssigned(
  companyId: string,
  issueId: string,
  agent: { id: string; agentKey: string | null },
): Promise<void> {
  const labelId = await ensureAiLabel(companyId);
  await db.insert(issueLabels).values({ companyId, issueId, labelId }).onConflictDoNothing();
  await dispatchAgentTask(companyId, issueId, agent.id, 'assigned');
}
