import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { requirements, projects } from '@/db/schema';
import { serializeRequirement } from '@/lib/serialize';
import { ApiException } from '@/lib/envelope';
import { nextKey } from '@/lib/keys';
import type { Actor } from './types';

/* Requirements / PRD business service. Ported from
   apps/spms-server/src/routes/requirements.ts (tenant scoping removed).
   A requirement is scoped to a project, typed functional vs non_functional
   (with an NFR category), and is decomposed into issues (issues.requirementId).
   Addressed by display `key` (functional → "FR-N", non-functional → "NFR-N"),
   mirroring the issue key contract. */

type RequirementRow = typeof requirements.$inferSelect;
export type RequirementType = RequirementRow['type'];
export type RequirementCategory = RequirementRow['category'];
export type RequirementStatus = RequirementRow['status'];
export type RequirementPriority = RequirementRow['priority'];
export type RequirementImportance = RequirementRow['importance'];

const withIssues = { issues: { columns: { key: true, status: true } } } as const;

async function findByKey(key: string) {
  return db.query.requirements.findFirst({ where: eq(requirements.key, key) });
}

/* ---- list (optionally filtered by project / type), position asc ---- */
export async function listRequirements(filter?: { project?: string; type?: RequirementType }) {
  const conds = [];
  if (filter?.project) conds.push(eq(requirements.projectId, filter.project));
  if (filter?.type) conds.push(eq(requirements.type, filter.type));
  const rows = await db.query.requirements.findMany({
    where: conds.length ? and(...conds) : undefined,
    with: withIssues,
    orderBy: [asc(requirements.position)],
  });
  return rows.map(serializeRequirement);
}

/* ---- single requirement (+ linked issue keys). Missing → null ---- */
export async function getRequirement(key: string) {
  const row = await db.query.requirements.findFirst({
    where: eq(requirements.key, key),
    with: withIssues,
  });
  return row ? serializeRequirement(row) : null;
}

export interface CreateRequirementInput {
  projectId: string;
  title: string;
  type?: RequirementType;
  category?: RequirementCategory;
  priority?: RequirementPriority;
  importance?: RequirementImportance;
  status?: RequirementStatus;
  description?: string | null;
  acceptanceCriteria?: string | null;
  releaseId?: string | null;
  aiOwnerId?: string | null;
  position?: number;
}

/* ---- create (auto FR-N / NFR-N key per type) ---- */
export async function createRequirement(actor: Actor, input: CreateRequirementInput) {
  if (!input.title.trim()) throw new ApiException('VALIDATION_FAILED', '需求标题不能为空');
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!project) throw new ApiException('PROJECT_NOT_FOUND');

  // Key prefix reflects the type: functional → FR-N, non-functional → NFR-N,
  // each with its own sequence. The key is the stable identifier (issues link by
  // it) — it's fixed at creation and not rewritten if the type later changes,
  // mirroring the issue-key contract.
  const type = input.type ?? 'functional';
  const id = crypto.randomUUID();
  const key = await nextKey(type === 'non_functional' ? 'NFR' : 'FR');
  await db.insert(requirements).values({
    id,
    key,
    projectId: input.projectId,
    title: input.title.trim(),
    type,
    // Only meaningful for non_functional requirements; null for functional ones.
    category: type === 'non_functional' ? (input.category ?? null) : null,
    priority: input.priority ?? 'none',
    importance: input.importance ?? 'none',
    status: input.status ?? 'draft',
    description: input.description ?? null,
    acceptanceCriteria: input.acceptanceCriteria ?? null,
    releaseId: input.releaseId ?? null,
    authorId: actor.memberId,
    aiOwnerId: input.aiOwnerId ?? null,
    position: input.position ?? 0,
  });

  const row = await db.query.requirements.findFirst({
    where: eq(requirements.id, id),
    with: withIssues,
  });
  return serializeRequirement(row!);
}

export interface UpdateRequirementInput {
  projectId?: string;
  title?: string;
  type?: RequirementType;
  category?: RequirementCategory;
  priority?: RequirementPriority;
  importance?: RequirementImportance;
  status?: RequirementStatus;
  description?: string | null;
  acceptanceCriteria?: string | null;
  releaseId?: string | null;
  aiOwnerId?: string | null;
  position?: number;
}

/* ---- update (partial) ---- */
export async function updateRequirement(key: string, input: UpdateRequirementInput) {
  const existing = await findByKey(key);
  if (!existing) throw new ApiException('REQUIREMENT_NOT_FOUND', `需求 ${key} 不存在`);

  const patch: Partial<typeof requirements.$inferInsert> = { updatedAt: new Date() };
  if (input.projectId !== undefined) patch.projectId = input.projectId;
  if (input.title !== undefined) patch.title = input.title;
  if (input.type !== undefined) patch.type = input.type;
  if (input.category !== undefined) patch.category = input.category;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.importance !== undefined) patch.importance = input.importance;
  if (input.status !== undefined) patch.status = input.status;
  if (input.description !== undefined) patch.description = input.description;
  if (input.acceptanceCriteria !== undefined) patch.acceptanceCriteria = input.acceptanceCriteria;
  if (input.releaseId !== undefined) patch.releaseId = input.releaseId;
  if (input.aiOwnerId !== undefined) patch.aiOwnerId = input.aiOwnerId;
  if (input.position !== undefined) patch.position = input.position;
  // Clearing the type to functional drops any NFR category.
  if (input.type === 'functional') patch.category = null;

  await db.update(requirements).set(patch).where(eq(requirements.id, existing.id));

  const row = await db.query.requirements.findFirst({
    where: eq(requirements.id, existing.id),
    with: withIssues,
  });
  return serializeRequirement(row!);
}

/* ---- delete (hard delete; referencing issues' requirementId is set null by
   the DB FK onDelete rule) ---- */
export async function deleteRequirement(key: string) {
  const existing = await findByKey(key);
  if (!existing) throw new ApiException('REQUIREMENT_NOT_FOUND', `需求 ${key} 不存在`);
  await db.delete(requirements).where(eq(requirements.id, existing.id));
  return { id: key };
}
