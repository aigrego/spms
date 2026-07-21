import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { projects, teams, releases, issues } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { assignMember, clearSubtreeAssignments } from '@/lib/assignments';
import type { Actor } from './types';

/* Project business service. Ported from apps/spms-server/src/routes/projects.ts
   (tenant scoping + ACL permission gates removed — the rewrite has role-based
   auth only; the route layer decides authorization). Projects are addressed by
   their uuid `id` and ship in the bootstrap payload. */

type ProjectRow = typeof projects.$inferSelect;
export type ProjectStatus = ProjectRow['status'];

// Validate that an optional team / release exists.
async function teamExists(id: string) {
  const [r] = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, id)).limit(1);
  return !!r;
}
async function releaseExists(id: string) {
  const [r] = await db.select({ id: releases.id }).from(releases).where(eq(releases.id, id)).limit(1);
  return !!r;
}

export interface CreateProjectInput {
  name: string;
  teamId?: string | null;
  releaseId?: string | null;
  status?: ProjectStatus;
  leadId?: string | null;
  aiLeadId?: string | null;
  icon?: string;
  color?: string;
  target?: string | null;
  description?: string | null;
  summary?: string | null;
  goal?: string | null;
  nonGoals?: string | null;
}

/* ---- create ---- */
export async function createProject(actor: Actor, input: CreateProjectInput) {
  if (!input.name.trim()) throw new ApiException('VALIDATION_FAILED', '项目名称不能为空');
  if (input.teamId && !(await teamExists(input.teamId))) throw new ApiException('TEAM_NOT_FOUND');
  if (input.releaseId && !(await releaseExists(input.releaseId))) {
    throw new ApiException('RELEASE_NOT_FOUND');
  }

  const id = crypto.randomUUID();
  await db.insert(projects).values({
    id,
    name: input.name.trim(),
    teamId: input.teamId ?? null,
    releaseId: input.releaseId ?? null,
    status: input.status ?? 'backlog',
    leadId: input.leadId ?? null,
    aiLeadId: input.aiLeadId ?? null,
    icon: input.icon ?? 'box',
    color: input.color ?? '#0063D3',
    target: input.target ?? null,
    description: input.description ?? null,
    summary: input.summary ?? null,
    goal: input.goal ?? null,
    nonGoals: input.nonGoals ?? null,
  });
  // PMS-2 §2.2: lead double-write — mirror leadId/aiLeadId as virtual-team
  // assignments (propagates up to release/product).
  if (input.leadId) await assignMember('project', id, input.leadId, 'lead', actor.memberId);
  if (input.aiLeadId) await assignMember('project', id, input.aiLeadId, 'member', actor.memberId);
  const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return row;
}

export interface UpdateProjectInput {
  name?: string;
  teamId?: string | null;
  releaseId?: string | null;
  status?: ProjectStatus;
  leadId?: string | null;
  aiLeadId?: string | null;
  icon?: string;
  color?: string;
  target?: string | null;
  description?: string | null;
  summary?: string | null;
  goal?: string | null;
  nonGoals?: string | null;
}

/* ---- update (partial) ---- */
export async function updateProject(actor: Actor, id: string, input: UpdateProjectInput) {
  const [existing] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
  if (!existing) throw new ApiException('PROJECT_NOT_FOUND');
  if (input.teamId && !(await teamExists(input.teamId))) throw new ApiException('TEAM_NOT_FOUND');
  if (input.releaseId && !(await releaseExists(input.releaseId))) {
    throw new ApiException('RELEASE_NOT_FOUND');
  }

  const patch: Partial<typeof projects.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.teamId !== undefined) patch.teamId = input.teamId;
  if (input.releaseId !== undefined) patch.releaseId = input.releaseId;
  if (input.status !== undefined) patch.status = input.status;
  if (input.leadId !== undefined) patch.leadId = input.leadId;
  if (input.aiLeadId !== undefined) patch.aiLeadId = input.aiLeadId;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.color !== undefined) patch.color = input.color;
  if (input.target !== undefined) patch.target = input.target;
  if (input.description !== undefined) patch.description = input.description;
  if (input.summary !== undefined) patch.summary = input.summary;
  if (input.goal !== undefined) patch.goal = input.goal;
  if (input.nonGoals !== undefined) patch.nonGoals = input.nonGoals;
  await db.update(projects).set(patch).where(eq(projects.id, id));

  // Keep the lead double-write in sync (PMS-2 §2.2). Mirrors the blueprint:
  // setting a lead (re)assigns; clearing leadId does NOT unassign.
  if (input.leadId) await assignMember('project', id, input.leadId, 'lead', actor.memberId);
  if (input.aiLeadId) await assignMember('project', id, input.aiLeadId, 'member', actor.memberId);
  const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return row;
}

/* ---- delete ---- (detaches issues, cascades requirements/sprints) */
export async function deleteProject(id: string) {
  const [existing] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
  if (!existing) throw new ApiException('PROJECT_NOT_FOUND');
  // PMS-2: clear the polymorphic virtual-team rows for the project + its sprints
  // BEFORE the row (and its cascading sprints) vanish.
  await clearSubtreeAssignments('project', id);
  // issues.projectId detaches (set null), not delete — issues survive.
  // Requirements cascade-delete, which auto-nulls those issues' requirementId.
  await db.update(issues).set({ projectId: null }).where(eq(issues.projectId, id));
  await db.delete(projects).where(eq(projects.id, id));
  return { id };
}
