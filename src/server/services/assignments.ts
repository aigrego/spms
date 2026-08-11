import { and, asc, eq, ne } from 'drizzle-orm';
import { db } from '@/db';
import { resourceAssignments, members, issues, products, projects } from '@/db/schema';
import { ApiException, type ErrorCode } from '@/lib/envelope';
import { serializeMember, companyRolesFor, withCompanyRole } from './resources';
import {
  assignMember,
  unassignMember,
  nodeExists,
  nodeMemberIds,
  parentsOf,
  subtreeImpact,
  type AssignmentNodeType,
} from '@/lib/assignments';
import { requirePerm } from '@/lib/permissions';
import type { Actor } from './types';

/* PMS-2 §5.2 — node resource assignment (虚拟团队) business service. Ported
   from apps/spms-server/src/routes/assignments.ts. Read/assign/unassign a
   node's team; assign propagates up the lifecycle, unassign cascades down + GCs.

   Multi-company: every function takes the Actor and works inside
   actor.companyId (the lib functions take it as their first parameter).
   Module gate: `resources` read/write. */

export type AssignmentRole = 'lead' | 'member';

const NODE_NOT_FOUND: Record<AssignmentNodeType, ErrorCode> = {
  product: 'PRODUCT_NOT_FOUND',
  release: 'RELEASE_NOT_FOUND',
  project: 'PROJECT_NOT_FOUND',
  sprint: 'SPRINT_NOT_FOUND',
};

/* The node's assignments joined with the member, ordered lead-first then name. */
async function listNode(companyId: string, nodeType: AssignmentNodeType, nodeId: string) {
  const rows = await db.query.resourceAssignments.findMany({
    where: and(
      eq(resourceAssignments.companyId, companyId),
      eq(resourceAssignments.nodeType, nodeType),
      eq(resourceAssignments.nodeId, nodeId),
    ),
    with: { member: true },
    orderBy: [asc(resourceAssignments.role), asc(resourceAssignments.createdAt)],
  });
  return rows.map((r) => ({
    id: r.id,
    nodeType: r.nodeType,
    nodeId: r.nodeId,
    role: r.role,
    source: r.source,
    memberId: r.memberId,
    member: r.member ? serializeMember(r.member) : null,
  }));
}

/* ---- a node's virtual team (with source/role) ---- */
export async function listByNode(actor: Actor, nodeType: AssignmentNodeType, nodeId: string) {
  await requirePerm(actor, 'resources', 'read');
  return listNode(actor.companyId, nodeType, nodeId);
}

/* ---- candidates for assigning to a node: parent pool (quick) + whole pool ----
   parent(N) is the encouraged quick source; the whole active pool is the
   extended source. Each candidate is flagged assignedHere / inParentPool. */
export async function candidates(actor: Actor, nodeType: AssignmentNodeType, nodeId: string) {
  await requirePerm(actor, 'resources', 'read');
  const companyId = actor.companyId;
  if (!(await nodeExists(companyId, nodeType, nodeId))) throw new ApiException(NODE_NOT_FOUND[nodeType]);

  const assignedIds = await nodeMemberIds(companyId, nodeType, nodeId);
  const parents = await parentsOf(companyId, nodeType, nodeId);
  // product has no node parent → the whole pool IS its quick source; a sprint
  // spanning several projects gets the UNION of all parent project pools.
  let parentIds: Set<string> | null = null;
  if (parents.length) {
    parentIds = new Set<string>();
    for (const p of parents) {
      for (const id of await nodeMemberIds(companyId, p.nodeType, p.nodeId)) parentIds.add(id);
    }
  }

  // Active pool + still-invited externals (assignable now); never revoked.
  const pool = await db
    .select()
    .from(members)
    .where(and(eq(members.companyId, companyId), ne(members.status, 'revoked')))
    .orderBy(asc(members.type), asc(members.name));

  // TKT-31: 候选人携带在本公司的角色岗位，供负责人选择器展示。
  const companyRoleMap = await companyRolesFor(companyId);
  return {
    node: { nodeType, nodeId },
    hasParent: parents.length > 0,
    candidates: pool.map((m) => ({
      ...withCompanyRole(serializeMember(m), companyRoleMap),
      assignedHere: assignedIds.has(m.id),
      inParentPool: parentIds ? parentIds.has(m.id) : true,
    })),
  };
}

/* ---- candidate assignees for an issue = its sprint pool (else project pool) ----
   AI agents are pool-level resources — always candidates. */
export async function issueCandidates(actor: Actor, issueKey: string) {
  await requirePerm(actor, 'resources', 'read');
  const companyId = actor.companyId;
  const [issue] = await db
    .select({ sprintId: issues.sprintId, projectId: issues.projectId })
    .from(issues)
    .where(and(eq(issues.companyId, companyId), eq(issues.key, issueKey)))
    .limit(1);
  if (!issue) throw new ApiException('ISSUE_NOT_FOUND', `Issue ${issueKey} 不存在`);

  const node: { nodeType: AssignmentNodeType; nodeId: string } | null = issue.sprintId
    ? { nodeType: 'sprint', nodeId: issue.sprintId }
    : issue.projectId
      ? { nodeType: 'project', nodeId: issue.projectId }
      : null;

  // Resolve the candidate member ids: the node pool when scoped, else the whole
  // active pool.
  const pool = await db
    .select()
    .from(members)
    .where(and(eq(members.companyId, companyId), ne(members.status, 'revoked')));
  const poolIds = node ? await nodeMemberIds(companyId, node.nodeType, node.nodeId) : null;
  const list = pool.filter((m) => !poolIds || m.type === 'agent' || poolIds.has(m.id));

  // TKT-31: 候选人携带在本公司的角色岗位，供负责人选择器展示。
  const companyRoleMap = await companyRolesFor(companyId);
  return {
    // 'tenant' kept from the blueprint contract (frontend branches on it); in the
    // company sandbox it simply means "no node scope — the whole pool".
    source: node ? node.nodeType : 'tenant',
    candidates: list.map((m) => withCompanyRole(serializeMember(m), companyRoleMap)),
  };
}

/* ---- impact preview for a destructive cascade (type-to-confirm dialog) ---- */
export async function impact(actor: Actor, nodeType: AssignmentNodeType, nodeId: string) {
  await requirePerm(actor, 'resources', 'read');
  if (!(await nodeExists(actor.companyId, nodeType, nodeId))) throw new ApiException(NODE_NOT_FOUND[nodeType]);
  return subtreeImpact(actor.companyId, nodeType, nodeId);
}

export interface AssignInput {
  nodeType: AssignmentNodeType;
  nodeId: string;
  memberId: string;
  role?: AssignmentRole;
}

/* ---- assign a member to a node → propagate up the ancestor chain ---- */
export async function assign(actor: Actor, input: AssignInput) {
  await requirePerm(actor, 'resources', 'write');
  const companyId = actor.companyId;
  if (!(await nodeExists(companyId, input.nodeType, input.nodeId))) {
    throw new ApiException(NODE_NOT_FOUND[input.nodeType]);
  }

  const [member] = await db
    .select({ id: members.id, status: members.status })
    .from(members)
    .where(and(eq(members.companyId, companyId), eq(members.id, input.memberId)))
    .limit(1);
  if (!member) throw new ApiException('RESOURCE_NOT_FOUND');
  if (member.status === 'revoked') throw new ApiException('RESOURCE_REVOKED');

  await assignMember(companyId, input.nodeType, input.nodeId, input.memberId, input.role ?? 'member', actor.memberId);
  return listNode(companyId, input.nodeType, input.nodeId);
}

/* ---- change an assignment's role (set/clear lead) ----
   Single-lead semantics: crowning a member demotes the node's other leads to
   'member' (propagated rows are always 'member', so in practice these are the
   other direct leads). For product/project nodes the legacy single-value
   leadId column is kept in sync — crown writes it, uncrown nulls it only when
   it still points at this member — so report visibility / lead grouping follow
   the crown. The sync touches only the node itself: role changes never
   propagate to ancestors/descendants (mirrors assignMember, which propagates
   membership but never roles). */
export async function updateRole(actor: Actor, id: string, role: AssignmentRole) {
  await requirePerm(actor, 'resources', 'write');
  const [row] = await db
    .select({
      id: resourceAssignments.id,
      nodeType: resourceAssignments.nodeType,
      nodeId: resourceAssignments.nodeId,
      memberId: resourceAssignments.memberId,
    })
    .from(resourceAssignments)
    .where(and(eq(resourceAssignments.companyId, actor.companyId), eq(resourceAssignments.id, id)))
    .limit(1);
  if (!row) throw new ApiException('RESOURCE_NOT_FOUND');
  await db.update(resourceAssignments).set({ role }).where(eq(resourceAssignments.id, id));

  if (role === 'lead') {
    await db
      .update(resourceAssignments)
      .set({ role: 'member' })
      .where(
        and(
          eq(resourceAssignments.companyId, actor.companyId),
          eq(resourceAssignments.nodeType, row.nodeType),
          eq(resourceAssignments.nodeId, row.nodeId),
          eq(resourceAssignments.role, 'lead'),
          ne(resourceAssignments.id, id),
        ),
      );
  }

  // sprint/release have no leadId column — the demotion above is all they get.
  if (row.nodeType === 'product') {
    if (role === 'lead') {
      await db
        .update(products)
        .set({ leadId: row.memberId })
        .where(and(eq(products.companyId, actor.companyId), eq(products.id, row.nodeId)));
    } else {
      await db
        .update(products)
        .set({ leadId: null })
        .where(
          and(eq(products.companyId, actor.companyId), eq(products.id, row.nodeId), eq(products.leadId, row.memberId)),
        );
    }
  } else if (row.nodeType === 'project') {
    if (role === 'lead') {
      await db
        .update(projects)
        .set({ leadId: row.memberId })
        .where(and(eq(projects.companyId, actor.companyId), eq(projects.id, row.nodeId)));
    } else {
      await db
        .update(projects)
        .set({ leadId: null })
        .where(
          and(eq(projects.companyId, actor.companyId), eq(projects.id, row.nodeId), eq(projects.leadId, row.memberId)),
        );
    }
  }
  return { id, role };
}

/* ---- unassign a member from a node → cascade down + GC propagated ----
   A `propagated` row can't be removed here (remove at the source node). */
export async function remove(actor: Actor, nodeType: AssignmentNodeType, nodeId: string, memberId: string) {
  await requirePerm(actor, 'resources', 'write');
  const companyId = actor.companyId;
  const [row] = await db
    .select({ source: resourceAssignments.source })
    .from(resourceAssignments)
    .where(
      and(
        eq(resourceAssignments.companyId, companyId),
        eq(resourceAssignments.nodeType, nodeType),
        eq(resourceAssignments.nodeId, nodeId),
        eq(resourceAssignments.memberId, memberId),
      ),
    )
    .limit(1);
  if (!row) throw new ApiException('RESOURCE_NOT_FOUND', '该成员未指派到此节点');
  if (row.source === 'propagated') {
    throw new ApiException('VALIDATION_FAILED', '该成员在此为传播指派，请到来源（子）节点移除');
  }
  await unassignMember(companyId, nodeType, nodeId, memberId);
  return { removed: true };
}
