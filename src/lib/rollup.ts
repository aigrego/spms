import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { issues, projects } from '@/db/schema';

/* PMS-2 §4 — derived rollup. Progress is NOT stored; it is computed from the
   actual completion of the issues in a scope, weighted by story points (falling
   back to issue count when a scope has no points). This keeps the up-the-tree
   indicators (project / release progress) honest against the real work state.

   Ported from apps/spms-server/src/lib/rollup.ts. Multi-company: the rollup is
   computed within one company sandbox (companyId parameter). */

const DONE = new Set(['done']);

type IssueRow = { projectId: string | null; status: string; storyPoints: number | null };

export function progressOf(items: IssueRow[]): number {
  if (!items.length) return 0;
  const totalPts = items.reduce((s, i) => s + (i.storyPoints ?? 0), 0);
  if (totalPts > 0) {
    const donePts = items.filter((i) => DONE.has(i.status)).reduce((s, i) => s + (i.storyPoints ?? 0), 0);
    return +(donePts / totalPts).toFixed(4);
  }
  const done = items.filter((i) => DONE.has(i.status)).length;
  return +(done / items.length).toFixed(4);
}

/* Compute per-project and per-release progress in two queries, scoped to one
   company. release scope = the union of issues across all projects on that release. */
export async function computeRollups(companyId: string) {
  const [issueRows, projRows] = await Promise.all([
    db
      .select({ projectId: issues.projectId, status: issues.status, storyPoints: issues.storyPoints })
      .from(issues)
      .where(eq(issues.companyId, companyId)),
    db
      .select({ id: projects.id, releaseId: projects.releaseId })
      .from(projects)
      .where(eq(projects.companyId, companyId)),
  ]);

  const projRelease = new Map(projRows.map((p) => [p.id, p.releaseId]));
  const byProject = new Map<string, IssueRow[]>();
  const byRelease = new Map<string, IssueRow[]>();
  const push = (map: Map<string, IssueRow[]>, key: string, row: IssueRow) => {
    const arr = map.get(key);
    if (arr) arr.push(row);
    else map.set(key, [row]);
  };
  for (const r of issueRows) {
    if (!r.projectId) continue;
    push(byProject, r.projectId, r);
    const rel = projRelease.get(r.projectId);
    if (rel) push(byRelease, rel, r);
  }

  const projectProgress = new Map<string, number>();
  for (const [pid, items] of byProject) projectProgress.set(pid, progressOf(items));
  const releaseProgress = new Map<string, number>();
  for (const [rid, items] of byRelease) releaseProgress.set(rid, progressOf(items));
  return { projectProgress, releaseProgress };
}
