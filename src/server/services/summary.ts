import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  activities,
  issueStatusTransitions,
  issues,
  members,
  requirements,
  sprints,
  testCases,
} from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { requirePerm } from '@/lib/permissions';
import type {
  IssueStatus,
  RequirementStatus,
  SummaryBucket,
  SummaryDurationStat,
  SummaryMemberRow,
  SummaryMetric,
  TeamSummary,
} from '@/lib/types';
import type { Actor } from './types';

/* Team summary service (团队总结, TKT-33).

   周期口径:每日 = 所选日历日;每周 = 所选日所在自然周(周一至周日)。客户端按本地
   时区给出 'YYYY-MM-DD' day key 与 tzMin(本地 = UTC + tzMin 分钟),服务端把日历日
   换算成 UTC 毫秒边界后纯 JS 分桶 —— 与 reports 模块同一套防 UTC 偏移约定。

   数据口径:
     - 新建 = 实体 createdAt 落入周期;
     - 交付 = 状态流转 to 'testing';验收完成 = 流转 to 'done' ∪ completedAt
       兜底(Notion 同步只回写 completedAt,不写流转),按 issue 去重;
     - 验收打回 = 从 'testing' 回到 todo/in_progress/backlog;重开 = 从 'done'
       去到任何非 done;
     - 成员过滤:流量指标按行为人(流转 whoId / 创建活动 whoId / 作者),存量指标
       (在办/待验收/积压)按当前负责人;项目过滤按 issue/需求/用例当前所属项目。 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function shiftDay(day: string, offset: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function weekMonday(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return shiftDay(day, -((dow + 6) % 7));
}

interface Bounds {
  startMs: number;
  endMs: number; // exclusive
}

export interface SummaryQuery {
  period: 'daily' | 'weekly';
  date: string;
  tzMin?: number;
  memberId?: string;
  projectId?: string;
}

type IssueRow = Pick<
  typeof issues.$inferSelect,
  | 'id'
  | 'key'
  | 'status'
  | 'assigneeId'
  | 'projectId'
  | 'storyPoints'
  | 'sprintId'
  | 'createdAt'
  | 'updatedAt'
  | 'completedAt'
  | 'archivedAt'
>;
type TransRow = Pick<
  typeof issueStatusTransitions.$inferSelect,
  'issueId' | 'fromStatus' | 'toStatus' | 'whoId' | 'createdAt'
>;

function durationStat(durs: { ms: number; key: string }[]): SummaryDurationStat {
  if (durs.length === 0) return { count: 0, avgMs: null, p90Ms: null, maxMs: null, maxKey: null };
  const sorted = [...durs].sort((a, b) => a.ms - b.ms);
  const p90 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)];
  const max = sorted[sorted.length - 1];
  return {
    count: durs.length,
    avgMs: Math.round(durs.reduce((s, d) => s + d.ms, 0) / durs.length),
    p90Ms: p90.ms,
    maxMs: max.ms,
    maxKey: max.key,
  };
}

export async function teamSummary(actor: Actor, query: SummaryQuery): Promise<TeamSummary> {
  await requirePerm(actor, 'reports', 'read');
  if (!DAY_RE.test(query.date)) {
    throw new ApiException('VALIDATION_FAILED', '日期格式应为 YYYY-MM-DD');
  }
  const tzMin = Number.isFinite(query.tzMin) ? (query.tzMin as number) : 0;
  const memberId = query.memberId || undefined;
  const projectId = query.projectId || undefined;

  // 周期边界(UTC 毫秒):day key 的本地零点 = UTC 零点 − tzMin。
  const dayStartMs = (day: string) => Date.parse(`${day}T00:00:00Z`) - tzMin * 60_000;
  const boundsOf = (start: string, end: string): Bounds => ({ startMs: dayStartMs(start), endMs: dayStartMs(shiftDay(end, 1)) });
  const dayKeyOf = (ts: Date) => new Date(ts.getTime() + tzMin * 60_000).toISOString().slice(0, 10);
  const inBounds = (ts: Date | null, b: Bounds) => ts != null && ts.getTime() >= b.startMs && ts.getTime() < b.endMs;

  const start = query.period === 'weekly' ? weekMonday(query.date) : query.date;
  const end = query.period === 'weekly' ? shiftDay(start, 6) : query.date;
  const cur = boundsOf(start, end);
  const prevStart = shiftDay(start, query.period === 'weekly' ? -7 : -1);
  const prevEnd = shiftDay(end, query.period === 'weekly' ? -7 : -1);
  const prev = boundsOf(prevStart, prevEnd);

  const [issueRows, transRows, createdActs, reqRows, tcRows, sprintRows, memberRows] = await Promise.all([
    db
      .select({
        id: issues.id,
        key: issues.key,
        status: issues.status,
        assigneeId: issues.assigneeId,
        projectId: issues.projectId,
        storyPoints: issues.storyPoints,
        sprintId: issues.sprintId,
        createdAt: issues.createdAt,
        updatedAt: issues.updatedAt,
        completedAt: issues.completedAt,
        archivedAt: issues.archivedAt,
      })
      .from(issues)
      .where(eq(issues.companyId, actor.companyId)),
    db
      .select({
        issueId: issueStatusTransitions.issueId,
        fromStatus: issueStatusTransitions.fromStatus,
        toStatus: issueStatusTransitions.toStatus,
        whoId: issueStatusTransitions.whoId,
        createdAt: issueStatusTransitions.createdAt,
      })
      .from(issueStatusTransitions)
      .where(eq(issueStatusTransitions.companyId, actor.companyId))
      .orderBy(asc(issueStatusTransitions.createdAt)),
    db
      .select({ issueId: activities.issueId, whoId: activities.whoId, createdAt: activities.createdAt })
      .from(activities)
      .where(and(eq(activities.companyId, actor.companyId), eq(activities.kind, 'created'))),
    db
      .select({
        id: requirements.id,
        projectId: requirements.projectId,
        status: requirements.status,
        authorId: requirements.authorId,
        createdAt: requirements.createdAt,
      })
      .from(requirements)
      .where(eq(requirements.companyId, actor.companyId)),
    db
      .select({ id: testCases.id, projectId: testCases.projectId, authorId: testCases.authorId, createdAt: testCases.createdAt })
      .from(testCases)
      .where(eq(testCases.companyId, actor.companyId)),
    db.select({ id: sprints.id, endDate: sprints.endDate, status: sprints.status }).from(sprints).where(eq(sprints.companyId, actor.companyId)),
    db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.companyId, actor.companyId), eq(members.status, 'active'))),
  ]);

  const issueById = new Map(issueRows.map((r) => [r.id, r]));
  const sprintById = new Map(sprintRows.map((r) => [r.id, r]));

  /* 过滤器:issueOk 用于实体自身指标(新建/存量);transOk 用于流转事件;
     成员过滤对流量按行为人、对存量按当前负责人(见文件头口径说明)。 */
  const projectOk = (pid: string | null) => !projectId || pid === projectId;
  const issueOk = (iss: IssueRow) => projectOk(iss.projectId) && (!memberId || iss.assigneeId === memberId);
  const transOk = (tr: TransRow) => {
    const iss = issueById.get(tr.issueId);
    if (!iss || !projectOk(iss.projectId)) return false;
    return !memberId || tr.whoId === memberId;
  };

  /* ---- 卡片指标:本期 vs 上一同长周期 ---- */
  const cardsFor = (b: Bounds) => {
    const reqCreated = reqRows.filter(
      (r) => projectOk(r.projectId) && (!memberId || r.authorId === memberId) && inBounds(r.createdAt, b),
    ).length;
    // 成员过滤时按创建活动的行为人计;否则按 issue.createdAt。
    const issueCreated = memberId
      ? createdActs.filter((a) => {
          const iss = issueById.get(a.issueId);
          return iss && projectOk(iss.projectId) && a.whoId === memberId && inBounds(a.createdAt, b);
        }).length
      : issueRows.filter((r) => projectOk(r.projectId) && inBounds(r.createdAt, b)).length;
    const delivered = transRows.filter((tr) => tr.toStatus === 'testing' && inBounds(tr.createdAt, b) && transOk(tr)).length;
    const acceptedSet = new Set<string>();
    for (const tr of transRows) {
      if (tr.toStatus === 'done' && inBounds(tr.createdAt, b) && transOk(tr)) acceptedSet.add(tr.issueId);
    }
    for (const iss of issueRows) {
      if (iss.completedAt && inBounds(iss.completedAt, b) && issueOk(iss)) acceptedSet.add(iss.id);
    }
    const rejected = transRows.filter(
      (tr) =>
        tr.fromStatus === 'testing' &&
        (tr.toStatus === 'todo' || tr.toStatus === 'in_progress' || tr.toStatus === 'backlog') &&
        inBounds(tr.createdAt, b) &&
        transOk(tr),
    ).length;
    const reopened = transRows.filter(
      (tr) => tr.fromStatus === 'done' && tr.toStatus !== 'done' && inBounds(tr.createdAt, b) && transOk(tr),
    ).length;
    const tcCreated = tcRows.filter(
      (r) => projectOk(r.projectId) && (!memberId || r.authorId === memberId) && inBounds(r.createdAt, b),
    ).length;
    return { reqCreated, issueCreated, delivered, accepted: acceptedSet.size, rejected, reopened, tcCreated };
  };

  const metric = (c: number, p: number): SummaryMetric => ({ value: c, prev: p });
  const curCards = cardsFor(cur);
  const prevCards = cardsFor(prev);
  const cards = {
    reqCreated: metric(curCards.reqCreated, prevCards.reqCreated),
    issueCreated: metric(curCards.issueCreated, prevCards.issueCreated),
    delivered: metric(curCards.delivered, prevCards.delivered),
    accepted: metric(curCards.accepted, prevCards.accepted),
    rejected: metric(curCards.rejected, prevCards.rejected),
    reopened: metric(curCards.reopened, prevCards.reopened),
    tcCreated: metric(curCards.tcCreated, prevCards.tcCreated),
  };

  /* ---- 吞吐分桶(每日 = 日粒度;每周 = 周内 7 天 + 周趋势 12 周) ---- */
  const bucketKeys: string[] = [];
  if (query.period === 'weekly') {
    for (let i = 0; i < 7; i++) bucketKeys.push(shiftDay(start, i));
  } else {
    for (let i = 13; i >= 0; i--) bucketKeys.push(shiftDay(end, -i));
  }
  const weeklyKeys: string[] = [];
  if (query.period === 'weekly') {
    for (let i = 11; i >= 0; i--) weeklyKeys.push(shiftDay(start, -7 * i));
  }

  const newBuckets = (keys: string[]) => {
    const map = new Map<string, { req: number; iss: number; del: number; acc: Set<string> }>();
    for (const k of keys) map.set(k, { req: 0, iss: 0, del: 0, acc: new Set() });
    const add = (key: string, fn: (b: { req: number; iss: number; del: number; acc: Set<string> }) => void) => {
      const b = map.get(key);
      if (b) fn(b);
    };
    const finish = (): SummaryBucket[] =>
      keys.map((k) => {
        const b = map.get(k)!;
        return { date: k, reqCreated: b.req, issueCreated: b.iss, delivered: b.del, accepted: b.acc.size };
      });
    return { add, finish };
  };

  const daily = newBuckets(bucketKeys);
  const weekly = newBuckets(weeklyKeys);
  const addTo = (nb: ReturnType<typeof newBuckets>, ts: Date, fn: (b: { req: number; iss: number; del: number; acc: Set<string> }) => void) =>
    nb.add(dayKeyOf(ts), fn);
  const addToWeekly = (ts: Date, fn: (b: { req: number; iss: number; del: number; acc: Set<string> }) => void) =>
    weekly.add(weekMonday(dayKeyOf(ts)), fn);

  for (const r of reqRows) {
    if (!projectOk(r.projectId) || (memberId && r.authorId !== memberId)) continue;
    addTo(daily, r.createdAt, (b) => b.req++);
    addToWeekly(r.createdAt, (b) => b.req++);
  }
  for (const iss of issueRows) {
    if (!projectOk(iss.projectId)) continue;
    if (memberId) {
      // 成员视角下的"新建"按创建活动行为人归属(与卡片口径一致)。
      const act = createdActs.find((a) => a.issueId === iss.id && a.whoId === memberId);
      if (!act) continue;
      addTo(daily, act.createdAt, (b) => b.iss++);
      addToWeekly(act.createdAt, (b) => b.iss++);
    } else {
      addTo(daily, iss.createdAt, (b) => b.iss++);
      addToWeekly(iss.createdAt, (b) => b.iss++);
    }
  }
  for (const tr of transRows) {
    if (!transOk(tr)) continue;
    if (tr.toStatus === 'testing') {
      addTo(daily, tr.createdAt, (b) => b.del++);
      addToWeekly(tr.createdAt, (b) => b.del++);
    }
    if (tr.toStatus === 'done') {
      addTo(daily, tr.createdAt, (b) => b.acc.add(tr.issueId));
      addToWeekly(tr.createdAt, (b) => b.acc.add(tr.issueId));
    }
  }
  for (const iss of issueRows) {
    if (!iss.completedAt || !issueOk(iss)) continue;
    addTo(daily, iss.completedAt, (b) => b.acc.add(iss.id));
    addToWeekly(iss.completedAt, (b) => b.acc.add(iss.id));
  }

  /* ---- 周期时长(首次进入各段的流转落在本期内的 issue) ---- */
  const firstTesting = new Map<string, TransRow>();
  const firstDone = new Map<string, TransRow>();
  const lastTesting = new Map<string, TransRow>();
  for (const tr of transRows) {
    if (tr.toStatus === 'testing') {
      if (!firstTesting.has(tr.issueId)) firstTesting.set(tr.issueId, tr);
      lastTesting.set(tr.issueId, tr);
    }
    if (tr.toStatus === 'done' && !firstDone.has(tr.issueId)) firstDone.set(tr.issueId, tr);
  }

  const deliveryDurs: { ms: number; key: string }[] = [];
  const acceptanceDurs: { ms: number; key: string }[] = [];
  const e2eDurs: { ms: number; key: string }[] = [];
  for (const iss of issueRows) {
    if (!projectOk(iss.projectId)) continue;
    const ft = firstTesting.get(iss.id);
    if (ft && inBounds(ft.createdAt, cur) && (!memberId || ft.whoId === memberId)) {
      deliveryDurs.push({ ms: Math.max(0, ft.createdAt.getTime() - iss.createdAt.getTime()), key: iss.key });
    }
    // 首次验收:优先结构化流转;Notion 同步的 done 用 completedAt 兜底(无行为人,
    // 成员过滤时不归属任何人)。
    const fdTr = firstDone.get(iss.id);
    const fdAt = fdTr?.createdAt ?? iss.completedAt;
    const fdWho = fdTr ? fdTr.whoId : null;
    if (fdAt && inBounds(fdAt, cur) && (!memberId || fdWho === memberId)) {
      e2eDurs.push({ ms: Math.max(0, fdAt.getTime() - iss.createdAt.getTime()), key: iss.key });
      if (ft && ft.createdAt.getTime() < fdAt.getTime()) {
        acceptanceDurs.push({ ms: fdAt.getTime() - ft.createdAt.getTime(), key: iss.key });
      }
    }
  }

  /* ---- 验收积压(当前状态,与周期无关):停在 testing 的 issue ---- */
  const nowMs = Date.now();
  const backlogWaits: { ms: number; key: string }[] = [];
  for (const iss of issueRows) {
    if (iss.status !== 'testing' || iss.archivedAt || !issueOk(iss)) continue;
    const since = lastTesting.get(iss.id)?.createdAt ?? iss.updatedAt;
    backlogWaits.push({ ms: Math.max(0, nowMs - since.getTime()), key: iss.key });
  }
  const backlogStat = durationStat(backlogWaits);

  /* ---- 当前流动健康(当前状态,与周期无关) ---- */
  const issueStatus = { backlog: 0, todo: 0, in_progress: 0, testing: 0, done: 0, canceled: 0 } as Record<IssueStatus, number>;
  let wip = 0;
  let overdue = 0;
  let unassigned = 0;
  let stalled = 0;
  for (const iss of issueRows) {
    if (iss.archivedAt || !issueOk(iss)) continue;
    issueStatus[iss.status] += 1;
    const open = iss.status !== 'done' && iss.status !== 'canceled';
    if (iss.status === 'todo' || iss.status === 'in_progress') wip += 1;
    if (open && !iss.assigneeId) unassigned += 1;
    if (open && iss.sprintId) {
      const sp = sprintById.get(iss.sprintId);
      if (sp && sp.endDate.getTime() < nowMs) overdue += 1;
    }
    if ((iss.status === 'todo' || iss.status === 'in_progress' || iss.status === 'testing') && nowMs - iss.updatedAt.getTime() > 7 * DAY_MS) {
      stalled += 1;
    }
  }
  const requirementStatus = {
    draft: 0,
    reviewing: 0,
    approved: 0,
    in_dev: 0,
    shipped: 0,
    rejected: 0,
  } as Record<RequirementStatus, number>;
  for (const r of reqRows) {
    if (projectOk(r.projectId)) requirementStatus[r.status] += 1;
  }

  /* ---- 按成员(当前公司全部 active 成员;流量按行为人,存量按负责人) ---- */
  const memberStatRows: SummaryMemberRow[] = memberRows.map((m) => {
    const mid = m.id;
    const created = createdActs.filter((a) => {
      if (a.whoId !== mid || !inBounds(a.createdAt, cur)) return false;
      const iss = issueById.get(a.issueId);
      return iss != null && projectOk(iss.projectId);
    }).length;
    const myTrans = transRows.filter((tr) => tr.whoId === mid && inBounds(tr.createdAt, cur) && projectOk(issueById.get(tr.issueId)?.projectId ?? null));
    const delivered = myTrans.filter((tr) => tr.toStatus === 'testing').length;
    const accepted = myTrans.filter((tr) => tr.toStatus === 'done').length;
    const points = myTrans
      .filter((tr) => tr.toStatus === 'done')
      .reduce((s, tr) => s + (issueById.get(tr.issueId)?.storyPoints ?? 0), 0);
    const durs: number[] = [];
    for (const tr of myTrans) {
      if (tr.toStatus !== 'testing') continue;
      const iss = issueById.get(tr.issueId);
      if (iss && firstTesting.get(tr.issueId)?.createdAt.getTime() === tr.createdAt.getTime()) {
        durs.push(Math.max(0, tr.createdAt.getTime() - iss.createdAt.getTime()));
      }
    }
    let wipCount = 0;
    let pending = 0;
    for (const iss of issueRows) {
      if (iss.assigneeId !== mid || iss.archivedAt || !projectOk(iss.projectId)) continue;
      if (iss.status === 'todo' || iss.status === 'in_progress') wipCount += 1;
      if (iss.status === 'testing') pending += 1;
    }
    return {
      memberId: mid,
      created,
      delivered,
      accepted,
      avgDeliveryMs: durs.length ? Math.round(durs.reduce((s, d) => s + d, 0) / durs.length) : null,
      points,
      wip: wipCount,
      pendingAcceptance: pending,
    };
  });

  return {
    period: { start, end, prevStart, prevEnd },
    flowSince: transRows[0]?.createdAt.toISOString() ?? null,
    cards,
    throughput: daily.finish(),
    weeklyTrend: weekly.finish(),
    cycleTime: {
      delivery: durationStat(deliveryDurs),
      acceptance: durationStat(acceptanceDurs),
      e2e: durationStat(e2eDurs),
    },
    acceptanceBacklog: {
      count: backlogWaits.length,
      avgWaitMs: backlogStat.avgMs,
      maxWaitMs: backlogStat.maxMs,
      maxKey: backlogStat.maxKey,
    },
    flowHealth: { issueStatus, requirementStatus, wip, overdue, unassigned, stalled },
    members: memberStatRows,
  };
}
