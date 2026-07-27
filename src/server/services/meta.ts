import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  members,
  teams,
  labels,
  projects,
  sprints,
  productLines,
  products,
  releases,
  companies,
  companyMemberships,
} from '@/db/schema';
import { ensureAgents, ensureAiLabel } from '@/lib/identity';
import { computeRollups } from '@/lib/rollup';
import { permsForActor } from '@/lib/permissions';
import { visibleSetsFor } from '@/lib/visibility';
import type { Actor } from './types';

/* Reference data for app start-up. Ported from
   apps/spms-server/src/routes/meta.ts (GET /bootstrap).

   Multi-company: bootstrap(actor) serves the actor's current company sandbox.
   The member projection itself is ensured upstream (http.ts requireActor);
   here we only re-ensure the per-company AI agents + AI label as a fallback.
   Beyond the reference maps the payload carries the actor's company context:
   `companies` (enterable companies), `currentCompany`, `companyRole` and the
   effective module `permissions`. No module gate — logging in is enough. */

export async function bootstrap(actor: Actor) {
  const companyId = actor.companyId;
  await ensureAgents(companyId);
  await ensureAiLabel(companyId);

  const [memberRows, teamRows, labelRows, projectRows, sprintRows, productLineRows, productRows, releaseRows] =
    await Promise.all([
      db.select().from(members).where(eq(members.companyId, companyId)),
      db.select().from(teams).where(eq(teams.companyId, companyId)),
      db.select().from(labels).where(eq(labels.companyId, companyId)),
      db.select().from(projects).where(eq(projects.companyId, companyId)),
      db.select().from(sprints).where(eq(sprints.companyId, companyId)).orderBy(asc(sprints.startDate)),
      db
        .select()
        .from(productLines)
        .where(eq(productLines.companyId, companyId))
        .orderBy(asc(productLines.position)),
      db.select().from(products).where(eq(products.companyId, companyId)).orderBy(asc(products.position)),
      db.select().from(releases).where(eq(releases.companyId, companyId)).orderBy(asc(releases.position)),
    ]);

  // PMS-2 §4: project/release progress is DERIVED from issue completion, not the
  // stored column. Override the returned `progress` so the UI shows the truth.
  const { projectProgress, releaseProgress } = await computeRollups(companyId);

  // 可见性(visibility.ts):普通成员只看到「自己有 direct 指派」的节点——project
  // 可见其下 sprint、sprint 上溯 project;祖先(product/release)direct 不下放给
  // project/sprint;null = 管理员不限制;productLines 不过滤(导航壳)。
  const visible = await visibleSetsFor(actor);
  const visProjects = visible ? projectRows.filter((p) => visible.projectIds.includes(p.id)) : projectRows;
  const visSprints = visible ? sprintRows.filter((s) => visible.sprintIds.includes(s.id)) : sprintRows;
  const visProducts = visible ? productRows.filter((p) => visible.productIds.includes(p.id)) : productRows;
  const visReleases = visible ? releaseRows.filter((r) => visible.releaseIds.includes(r.id)) : releaseRows;

  // Companies the actor can enter: every company for a platform admin, else the
  // companies they hold a membership in (oldest membership first).
  const companyRows = actor.isPlatformAdmin
    ? await db.select().from(companies).orderBy(asc(companies.createdAt))
    : (
        await db
          .select({ company: companies })
          .from(companyMemberships)
          .innerJoin(companies, eq(companyMemberships.companyId, companies.id))
          .where(eq(companyMemberships.userId, actor.userId))
          .orderBy(asc(companyMemberships.createdAt))
      ).map((r) => r.company);

  let currentCompany = companyRows.find((c) => c.id === companyId) ?? null;
  if (!currentCompany) {
    // Defensive fallback (e.g. a platform admin edge case): load the row directly.
    const [c] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    currentCompany = c ?? null;
  }

  return {
    me: actor.memberId,
    role: actor.role,
    companyRole: actor.companyRole,
    companies: companyRows,
    currentCompany,
    permissions: await permsForActor(actor),
    members: memberRows,
    teams: teamRows,
    labels: labelRows,
    projects: visProjects.map((p) => ({ ...p, progress: projectProgress.get(p.id) ?? 0 })),
    sprints: visSprints,
    productLines: productLineRows,
    products: visProducts,
    releases: visReleases.map((r) => ({ ...r, progress: releaseProgress.get(r.id) ?? 0 })),
  };
}
