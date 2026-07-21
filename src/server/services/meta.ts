import { asc } from 'drizzle-orm';
import { db } from '@/db';
import { members, teams, labels, projects, sprints, productLines, products, releases } from '@/db/schema';
import { ensureCurrentMember, ensureAgents } from '@/lib/identity';
import { computeRollups } from '@/lib/rollup';

/* Reference data for app start-up. Ported from
   apps/spms-server/src/routes/meta.ts (GET /bootstrap, tenant scoping removed).
   Lazily bootstraps the (user → member) projection + the 4 AI agents, then
   returns `me` = the current user's member id. */

export async function bootstrap(currentUser: { id: string; name: string; role: string }) {
  const me = await ensureCurrentMember(currentUser);
  await ensureAgents();

  const [memberRows, teamRows, labelRows, projectRows, sprintRows, productLineRows, productRows, releaseRows] =
    await Promise.all([
      db.select().from(members),
      db.select().from(teams),
      db.select().from(labels),
      db.select().from(projects),
      db.select().from(sprints).orderBy(asc(sprints.startDate)),
      db.select().from(productLines).orderBy(asc(productLines.position)),
      db.select().from(products).orderBy(asc(products.position)),
      db.select().from(releases).orderBy(asc(releases.position)),
    ]);

  // PMS-2 §4: project/release progress is DERIVED from issue completion, not the
  // stored column. Override the returned `progress` so the UI shows the truth.
  const { projectProgress, releaseProgress } = await computeRollups();

  return {
    me: me.id,
    role: currentUser.role,
    members: memberRows,
    teams: teamRows,
    labels: labelRows,
    projects: projectRows.map((p) => ({ ...p, progress: projectProgress.get(p.id) ?? 0 })),
    sprints: sprintRows,
    productLines: productLineRows,
    products: productRows,
    releases: releaseRows.map((r) => ({ ...r, progress: releaseProgress.get(r.id) ?? 0 })),
  };
}
