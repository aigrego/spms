import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db';
import { issues, sprintSnapshots } from '@/db/schema';

/* Daily burndown snapshot writer. getBurndown (sprints.ts) reads
   sprint_snapshots for the "actual" line; this module is the only writer.
   Called after any mutation that can change a sprint's remaining points:
   issue status/storyPoints/sprintId changes, issue create/delete, sprint
   start/complete.

   One row per (sprint, calendar day), keyed by a deterministic id so the
   upsert needs no extra unique index. "Remaining" matches getSprint's stats
   definition: points of issues whose status is not `done`. */

const localDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function recordSprintSnapshot(companyId: string, sprintId: string | null | undefined) {
  if (!sprintId) return;
  const rows = await db
    .select({ storyPoints: issues.storyPoints, status: issues.status })
    .from(issues)
    .where(and(eq(issues.companyId, companyId), eq(issues.sprintId, sprintId), ne(issues.status, 'done')));
  const remaining = rows.reduce((s, r) => s + (r.storyPoints ?? 0), 0);
  // Local midnight: getBurndown matches snapshots by rounded day-diff against
  // the sprint start, so a timezone offset within ±12h still lands on the
  // right day.
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const id = `${sprintId}:${localDateKey(day)}`;
  await db
    .insert(sprintSnapshots)
    .values({ id, companyId, sprintId, day, remainingPoints: remaining })
    .onConflictDoUpdate({ target: sprintSnapshots.id, set: { remainingPoints: remaining } });
}
