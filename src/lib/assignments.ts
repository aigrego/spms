import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { resourceAssignments, sprints, sprintProjects, projects, releases, products } from '@/db/schema';

/* PMS-2 §3 — 研发资源 (virtual team) assignment + propagation algebra.

   The lifecycle is a tree:  product → release → project → sprint  (product line
   is the implicit pool root, NOT an assignment node) — with one relaxation: a
   sprint may span several projects (sprint_projects), so sprint is the one
   multi-parent node and ancestor walks fan out over all of them. The invariant:

     a member sits on node N  ⟺  they have a direct assignment on N or on some
     descendant of N           ⟹  they sit on every ancestor of N.

   assign  = upsert a `direct` row on N + create `propagated` rows up the ancestor
             chain (so the project/release/product auto-include the person).
   unassign= delete N + every descendant row for the member (cascade down) + GC any
             now-unjustified `propagated` ancestor rows.

   Node tables are addressed polymorphically (no FK) so this lib owns the walk.
   Ported from apps/spms-server/src/lib/assignments.ts (tenant scoping removed;
   ids are randomUUIDs).

   Multi-company: every function takes `companyId` as its first parameter —
   node lookups, assignment rows and cascade walks are all scoped to one
   company sandbox. */

export type AssignmentNodeType = 'product' | 'release' | 'project' | 'sprint';
export interface NodeRef {
  nodeType: AssignmentNodeType;
  nodeId: string;
}

/* The immediate lifecycle parents of a node (empty at the product root).
   A sprint can span several projects (sprint_projects) → multiple parents;
   every other node type still has at most one. */
export async function parentsOf(
  companyId: string,
  nodeType: AssignmentNodeType,
  nodeId: string,
): Promise<NodeRef[]> {
  if (nodeType === 'sprint') {
    const rows = await db
      .select({ projectId: sprintProjects.projectId })
      .from(sprintProjects)
      .where(and(eq(sprintProjects.sprintId, nodeId), eq(sprintProjects.companyId, companyId)));
    return rows.map((r): NodeRef => ({ nodeType: 'project', nodeId: r.projectId }));
  }
  if (nodeType === 'project') {
    const [p] = await db
      .select({ releaseId: projects.releaseId })
      .from(projects)
      .where(and(eq(projects.id, nodeId), eq(projects.companyId, companyId)))
      .limit(1);
    return p?.releaseId ? [{ nodeType: 'release', nodeId: p.releaseId }] : [];
  }
  if (nodeType === 'release') {
    const [r] = await db
      .select({ productId: releases.productId })
      .from(releases)
      .where(and(eq(releases.id, nodeId), eq(releases.companyId, companyId)))
      .limit(1);
    return r?.productId ? [{ nodeType: 'product', nodeId: r.productId }] : [];
  }
  return []; // product → pool root (implicit, no parent node)
}

/* The immediate lifecycle parent of a node (null at the product root).
   For a multi-project sprint this returns the FIRST parent — use parentsOf
   when all parents matter (propagation walks). */
export async function parentOf(
  companyId: string,
  nodeType: AssignmentNodeType,
  nodeId: string,
): Promise<NodeRef | null> {
  return (await parentsOf(companyId, nodeType, nodeId))[0] ?? null;
}

/* Ancestor set, nearest parents first, up to (and including) the product.
   BFS over parentsOf (a sprint may have several project parents), de-duped. */
export async function ancestorsOf(
  companyId: string,
  nodeType: AssignmentNodeType,
  nodeId: string,
): Promise<NodeRef[]> {
  const chain: NodeRef[] = [];
  const seen = new Set<string>();
  let frontier = await parentsOf(companyId, nodeType, nodeId);
  while (frontier.length) {
    const next: NodeRef[] = [];
    for (const cur of frontier) {
      const key = `${cur.nodeType}:${cur.nodeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      chain.push(cur);
      next.push(...(await parentsOf(companyId, cur.nodeType, cur.nodeId)));
    }
    frontier = next;
  }
  return chain;
}

/* Every node strictly below the given one that can carry an assignment. */
export async function descendantsOf(
  companyId: string,
  nodeType: AssignmentNodeType,
  nodeId: string,
): Promise<NodeRef[]> {
  const out: NodeRef[] = [];
  let releaseIds: string[] = [];
  let projectIds: string[] = [];

  if (nodeType === 'product') {
    const rels = await db
      .select({ id: releases.id })
      .from(releases)
      .where(and(eq(releases.productId, nodeId), eq(releases.companyId, companyId)));
    releaseIds = rels.map((r) => r.id);
    out.push(...releaseIds.map((id): NodeRef => ({ nodeType: 'release', nodeId: id })));
  } else if (nodeType === 'release') {
    releaseIds = [nodeId];
  }

  if (nodeType === 'project') {
    projectIds = [nodeId];
  } else if (releaseIds.length) {
    const projs = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(inArray(projects.releaseId, releaseIds), eq(projects.companyId, companyId)));
    projectIds = projs.map((p) => p.id);
    out.push(...projectIds.map((id): NodeRef => ({ nodeType: 'project', nodeId: id })));
  }

  if (projectIds.length) {
    const sprs = await db
      .select({ id: sprintProjects.sprintId })
      .from(sprintProjects)
      .where(and(inArray(sprintProjects.projectId, projectIds), eq(sprintProjects.companyId, companyId)));
    // a sprint spanning several of these projects must appear only once
    for (const s of new Set(sprs.map((r) => r.id))) out.push({ nodeType: 'sprint', nodeId: s });
  }
  return out;
}

/* Does the node exist in this company? (validates assignment targets) */
export async function nodeExists(
  companyId: string,
  nodeType: AssignmentNodeType,
  nodeId: string,
): Promise<boolean> {
  const table =
    nodeType === 'product'
      ? products
      : nodeType === 'release'
        ? releases
        : nodeType === 'project'
          ? projects
          : sprints;
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, nodeId), eq(table.companyId, companyId)))
    .limit(1);
  return !!row;
}

/* The member ids assigned to a node (its virtual team) — used for candidate pools. */
export async function nodeMemberIds(
  companyId: string,
  nodeType: AssignmentNodeType,
  nodeId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ memberId: resourceAssignments.memberId })
    .from(resourceAssignments)
    .where(
      and(
        eq(resourceAssignments.companyId, companyId),
        eq(resourceAssignments.nodeType, nodeType),
        eq(resourceAssignments.nodeId, nodeId),
      ),
    );
  return new Set(rows.map((r) => r.memberId));
}

/* §3.2 assign — upsert a direct row on N, then propagate `member` rows up the
   ancestor chain (leaving any pre-existing direct rows untouched). */
export async function assignMember(
  companyId: string,
  nodeType: AssignmentNodeType,
  nodeId: string,
  memberId: string,
  role: 'lead' | 'member' = 'member',
  addedById: string | null = null,
): Promise<void> {
  await db
    .insert(resourceAssignments)
    .values({ id: crypto.randomUUID(), companyId, nodeType, nodeId, memberId, role, source: 'direct', addedById })
    .onConflictDoUpdate({
      target: [resourceAssignments.nodeType, resourceAssignments.nodeId, resourceAssignments.memberId],
      set: { source: 'direct', role },
    });

  const ancestors = await ancestorsOf(companyId, nodeType, nodeId);
  for (const a of ancestors) {
    await db
      .insert(resourceAssignments)
      .values({
        id: crypto.randomUUID(),
        companyId,
        nodeType: a.nodeType,
        nodeId: a.nodeId,
        memberId,
        role: 'member',
        source: 'propagated',
        addedById,
      })
      .onConflictDoNothing();
  }
}

/* Is there a `direct` row for the member among any of these nodes? */
async function anyDirectAmong(companyId: string, refs: NodeRef[], memberId: string): Promise<boolean> {
  for (const r of refs) {
    const [row] = await db
      .select({ id: resourceAssignments.id })
      .from(resourceAssignments)
      .where(
        and(
          eq(resourceAssignments.companyId, companyId),
          eq(resourceAssignments.nodeType, r.nodeType),
          eq(resourceAssignments.nodeId, r.nodeId),
          eq(resourceAssignments.memberId, memberId),
          eq(resourceAssignments.source, 'direct'),
        ),
      )
      .limit(1);
    if (row) return true;
  }
  return false;
}

/* §3.4 unassign — cascade DOWN (delete N + every descendant row for the member),
   then GC any ancestor `propagated` row that no longer covers a direct descendant. */
export async function unassignMember(
  companyId: string,
  nodeType: AssignmentNodeType,
  nodeId: string,
  memberId: string,
): Promise<void> {
  const targets: NodeRef[] = [{ nodeType, nodeId }, ...(await descendantsOf(companyId, nodeType, nodeId))];
  for (const tref of targets) {
    await db
      .delete(resourceAssignments)
      .where(
        and(
          eq(resourceAssignments.companyId, companyId),
          eq(resourceAssignments.nodeType, tref.nodeType),
          eq(resourceAssignments.nodeId, tref.nodeId),
          eq(resourceAssignments.memberId, memberId),
        ),
      );
  }

  const ancestors = await ancestorsOf(companyId, nodeType, nodeId); // near → far
  for (const a of ancestors) {
    const [row] = await db
      .select({ id: resourceAssignments.id, source: resourceAssignments.source })
      .from(resourceAssignments)
      .where(
        and(
          eq(resourceAssignments.companyId, companyId),
          eq(resourceAssignments.nodeType, a.nodeType),
          eq(resourceAssignments.nodeId, a.nodeId),
          eq(resourceAssignments.memberId, memberId),
        ),
      )
      .limit(1);
    if (!row || row.source !== 'propagated') continue; // direct rows stay
    const desc = await descendantsOf(companyId, a.nodeType, a.nodeId);
    if (!(await anyDirectAmong(companyId, desc, memberId))) {
      await db.delete(resourceAssignments).where(eq(resourceAssignments.id, row.id));
    }
  }
}

/* Remove a member from EVERY node in the company (revoke / delete from pool).
   Since they vanish from all nodes at once, no ancestor GC pass is needed. */
export async function unassignMemberEverywhere(companyId: string, memberId: string): Promise<void> {
  await db
    .delete(resourceAssignments)
    .where(and(eq(resourceAssignments.companyId, companyId), eq(resourceAssignments.memberId, memberId)));
}

/* Clean up a node's assignments when the node itself is deleted (referential
   integrity for the polymorphic table). Does NOT touch ancestors (they may still
   be justified by siblings) — callers delete bottom-up. */
export async function clearNodeAssignments(
  companyId: string,
  nodeType: AssignmentNodeType,
  nodeId: string,
): Promise<void> {
  await db
    .delete(resourceAssignments)
    .where(
      and(
        eq(resourceAssignments.companyId, companyId),
        eq(resourceAssignments.nodeType, nodeType),
        eq(resourceAssignments.nodeId, nodeId),
      ),
    );
}

/* When a node is deleted its whole lifecycle subtree cascade-deletes (DB FK) but
   the polymorphic assignment rows don't — clear the node + every descendant. Call
   BEFORE deleting the node row (descendantsOf walks the still-present children). */
export async function clearSubtreeAssignments(
  companyId: string,
  nodeType: AssignmentNodeType,
  nodeId: string,
): Promise<void> {
  const refs: NodeRef[] = [{ nodeType, nodeId }, ...(await descendantsOf(companyId, nodeType, nodeId))];
  for (const r of refs) await clearNodeAssignments(companyId, r.nodeType, r.nodeId);
}

/* Sprints that die when the given projects are deleted: those whose EVERY
   sprint_projects link points inside the set (a sprint shared with projects
   outside the set survives — its link rows cascade away with the projects).
   Callers delete the returned sprints explicitly before deleting the projects,
   since the N:N move dropped the projects→sprints FK cascade. */
export async function sprintsDyingWithProjects(companyId: string, projectIds: string[]): Promise<string[]> {
  if (!projectIds.length) return [];
  const links = await db
    .select({ sprintId: sprintProjects.sprintId, projectId: sprintProjects.projectId })
    .from(sprintProjects)
    .where(and(eq(sprintProjects.companyId, companyId), inArray(sprintProjects.projectId, projectIds)));
  const insideCount = new Map<string, number>();
  for (const l of links) insideCount.set(l.sprintId, (insideCount.get(l.sprintId) ?? 0) + 1);
  const dying: string[] = [];
  for (const [sprintId, inside] of insideCount) {
    const total = await db
      .select({ projectId: sprintProjects.projectId })
      .from(sprintProjects)
      .where(and(eq(sprintProjects.companyId, companyId), eq(sprintProjects.sprintId, sprintId)));
    if (total.length === inside) dying.push(sprintId);
  }
  return dying;
}

/* Count the cascade-delete impact of removing a node (for the type-to-confirm
   dialog, PMS-2 §3.4 / §6.10): how many descendant nodes + assignment rows go.
   Sprints shared with projects outside the subtree survive — only sprints
   fully inside count as dying. */
export async function subtreeImpact(companyId: string, nodeType: AssignmentNodeType, nodeId: string) {
  const desc = await descendantsOf(companyId, nodeType, nodeId);
  const subtreeProjectIds = [
    ...(nodeType === 'project' ? [nodeId] : []),
    ...desc.filter((d) => d.nodeType === 'project').map((d) => d.nodeId),
  ];
  const dyingSprints = new Set(await sprintsDyingWithProjects(companyId, subtreeProjectIds));
  const counts = { release: 0, project: 0, sprint: 0 };
  const all: NodeRef[] = [{ nodeType, nodeId }];
  for (const d of desc) {
    if (d.nodeType === 'sprint' && !dyingSprints.has(d.nodeId)) continue;
    counts[d.nodeType as 'release' | 'project' | 'sprint']++;
    all.push(d);
  }
  let assignments = 0;
  for (const r of all) assignments += (await nodeMemberIds(companyId, r.nodeType, r.nodeId)).size;
  return { descendants: counts, assignments };
}
