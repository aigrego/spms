import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { productLines, products, releases } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { nextKey } from '@/lib/keys';
import { assignMember, clearSubtreeAssignments } from '@/lib/assignments';
import { requirePerm } from '@/lib/permissions';
import { visibleSetsFor } from '@/lib/visibility';
import type { Actor } from './types';

/* Lifecycle catalog business service: 产品线 → 产品 → 版本/Release.
   Ported from apps/spms-server/src/routes/catalog.ts (key allocation via the
   counters table). Entities are addressed by their uuid `id`, resolved on the
   frontend via the bootstrap maps.

   Multi-company: every function takes the Actor and reads/writes strictly
   inside actor.companyId; keys (PL-N/PD-N/RL-N) are unique per company.
   Module gate: `products` read/write. */

type ProductRow = typeof products.$inferSelect;
export type ProductStatus = ProductRow['status'];
type ReleaseRow = typeof releases.$inferSelect;
export type ReleaseStatus = ReleaseRow['status'];
export type LifecyclePhase = ReleaseRow['phase'];

/* ============================ Product lines ============================ */

export async function listProductLines(actor: Actor) {
  await requirePerm(actor, 'products', 'read');
  return db
    .select()
    .from(productLines)
    .where(eq(productLines.companyId, actor.companyId))
    .orderBy(asc(productLines.position));
}

export interface CreateProductLineInput {
  name: string;
  description?: string | null;
  color?: string;
  position?: number;
}

export async function createProductLine(actor: Actor, input: CreateProductLineInput) {
  await requirePerm(actor, 'products', 'write');
  if (!input.name.trim()) throw new ApiException('VALIDATION_FAILED', '名称不能为空');
  const id = crypto.randomUUID();
  const key = await nextKey(actor.companyId, 'PL');
  await db.insert(productLines).values({
    id,
    companyId: actor.companyId,
    key,
    name: input.name.trim(),
    description: input.description ?? null,
    color: input.color ?? '#0063D3',
    position: input.position ?? 0,
  });
  return { id, key };
}

export interface UpdateProductLineInput {
  name?: string;
  description?: string | null;
  color?: string;
  position?: number;
}

export async function updateProductLine(actor: Actor, id: string, input: UpdateProductLineInput) {
  await requirePerm(actor, 'products', 'write');
  const [existing] = await db
    .select({ id: productLines.id })
    .from(productLines)
    .where(and(eq(productLines.companyId, actor.companyId), eq(productLines.id, id)))
    .limit(1);
  if (!existing) throw new ApiException('PRODUCT_LINE_NOT_FOUND');
  const patch: Partial<typeof productLines.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.color !== undefined) patch.color = input.color;
  if (input.position !== undefined) patch.position = input.position;
  await db.update(productLines).set(patch).where(eq(productLines.id, id));
  return { id };
}

export async function deleteProductLine(actor: Actor, id: string) {
  await requirePerm(actor, 'products', 'write');
  const [existing] = await db
    .select({ id: productLines.id })
    .from(productLines)
    .where(and(eq(productLines.companyId, actor.companyId), eq(productLines.id, id)))
    .limit(1);
  if (!existing) throw new ApiException('PRODUCT_LINE_NOT_FOUND');
  // Clear virtual-team rows across the whole subtree before the cascade delete.
  const childProducts = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.companyId, actor.companyId), eq(products.productLineId, id)));
  for (const p of childProducts) {
    await clearSubtreeAssignments(actor.companyId, 'product', p.id);
  }
  await db.delete(productLines).where(eq(productLines.id, id));
  return { id };
}

/* =============================== Products =============================== */

export async function listProducts(actor: Actor, filter?: { line?: string }) {
  await requirePerm(actor, 'products', 'read');
  const conds = [eq(products.companyId, actor.companyId)];
  if (filter?.line) conds.push(eq(products.productLineId, filter.line));
  // 指派可见性(visibility.ts);null = 管理员不限制。
  const visible = await visibleSetsFor(actor);
  if (visible) conds.push(inArray(products.id, visible.productIds));
  return db
    .select()
    .from(products)
    .where(and(...conds))
    .orderBy(asc(products.position));
}

export interface CreateProductInput {
  productLineId: string;
  name: string;
  description?: string | null;
  icon?: string;
  color?: string;
  status?: ProductStatus;
  leadId?: string | null;
  position?: number;
}

export async function createProduct(actor: Actor, input: CreateProductInput) {
  await requirePerm(actor, 'products', 'write');
  if (!input.name.trim()) throw new ApiException('VALIDATION_FAILED', '名称不能为空');
  const [line] = await db
    .select({ id: productLines.id })
    .from(productLines)
    .where(and(eq(productLines.companyId, actor.companyId), eq(productLines.id, input.productLineId)))
    .limit(1);
  if (!line) throw new ApiException('PRODUCT_LINE_NOT_FOUND');
  const id = crypto.randomUUID();
  const key = await nextKey(actor.companyId, 'PD');
  await db.insert(products).values({
    id,
    companyId: actor.companyId,
    productLineId: input.productLineId,
    key,
    name: input.name.trim(),
    description: input.description ?? null,
    icon: input.icon ?? 'box',
    color: input.color ?? '#0063D3',
    status: input.status ?? 'active',
    leadId: input.leadId ?? null,
    position: input.position ?? 0,
  });
  // PMS-2 §2.2: lead double-write — mirror the product lead as a virtual-team
  // assignment on the product node.
  if (input.leadId) await assignMember(actor.companyId, 'product', id, input.leadId, 'lead', actor.memberId);
  return { id, key };
}

export interface UpdateProductInput {
  productLineId?: string;
  name?: string;
  description?: string | null;
  icon?: string;
  color?: string;
  status?: ProductStatus;
  leadId?: string | null;
  position?: number;
}

export async function updateProduct(actor: Actor, id: string, input: UpdateProductInput) {
  await requirePerm(actor, 'products', 'write');
  const [existing] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.companyId, actor.companyId), eq(products.id, id)))
    .limit(1);
  if (!existing) throw new ApiException('PRODUCT_NOT_FOUND');
  const patch: Partial<typeof products.$inferInsert> = {};
  if (input.productLineId !== undefined) patch.productLineId = input.productLineId;
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.color !== undefined) patch.color = input.color;
  if (input.status !== undefined) patch.status = input.status;
  if (input.leadId !== undefined) patch.leadId = input.leadId;
  if (input.position !== undefined) patch.position = input.position;
  await db.update(products).set(patch).where(eq(products.id, id));
  if (input.leadId) await assignMember(actor.companyId, 'product', id, input.leadId, 'lead', actor.memberId);
  return { id };
}

export async function deleteProduct(actor: Actor, id: string) {
  await requirePerm(actor, 'products', 'write');
  const [existing] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.companyId, actor.companyId), eq(products.id, id)))
    .limit(1);
  if (!existing) throw new ApiException('PRODUCT_NOT_FOUND');
  await clearSubtreeAssignments(actor.companyId, 'product', id);
  await db.delete(products).where(eq(products.id, id));
  return { id };
}

/* =============================== Releases =============================== */

export async function listReleases(actor: Actor, filter?: { product?: string }) {
  await requirePerm(actor, 'products', 'read');
  const conds = [eq(releases.companyId, actor.companyId)];
  if (filter?.product) conds.push(eq(releases.productId, filter.product));
  // 指派可见性(visibility.ts);null = 管理员不限制。
  const visible = await visibleSetsFor(actor);
  if (visible) conds.push(inArray(releases.id, visible.releaseIds));
  return db
    .select()
    .from(releases)
    .where(and(...conds))
    .orderBy(asc(releases.position));
}

export interface CreateReleaseInput {
  productId: string;
  name: string;
  description?: string | null;
  status?: ReleaseStatus;
  phase?: LifecyclePhase;
  targetDate?: Date | string | null;
  progress?: number;
  position?: number;
}

export async function createRelease(actor: Actor, input: CreateReleaseInput) {
  await requirePerm(actor, 'products', 'write');
  if (!input.name.trim()) throw new ApiException('VALIDATION_FAILED', '版本名称不能为空');
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.companyId, actor.companyId), eq(products.id, input.productId)))
    .limit(1);
  if (!product) throw new ApiException('PRODUCT_NOT_FOUND');
  const id = crypto.randomUUID();
  const key = await nextKey(actor.companyId, 'RL');
  await db.insert(releases).values({
    id,
    companyId: actor.companyId,
    productId: input.productId,
    key,
    name: input.name.trim(),
    description: input.description ?? null,
    status: input.status ?? 'planned',
    phase: input.phase ?? 'concept',
    targetDate: input.targetDate ? new Date(input.targetDate) : null,
    progress: input.progress ?? 0,
    position: input.position ?? 0,
  });
  return { id, key };
}

export interface UpdateReleaseInput {
  productId?: string;
  name?: string;
  description?: string | null;
  status?: ReleaseStatus;
  phase?: LifecyclePhase;
  targetDate?: Date | string | null;
  progress?: number;
  position?: number;
}

export async function updateRelease(actor: Actor, id: string, input: UpdateReleaseInput) {
  await requirePerm(actor, 'products', 'write');
  const [existing] = await db
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.companyId, actor.companyId), eq(releases.id, id)))
    .limit(1);
  if (!existing) throw new ApiException('RELEASE_NOT_FOUND');
  const patch: Partial<typeof releases.$inferInsert> = {};
  if (input.productId !== undefined) patch.productId = input.productId;
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.status !== undefined) patch.status = input.status;
  if (input.phase !== undefined) patch.phase = input.phase;
  if (input.targetDate !== undefined) patch.targetDate = input.targetDate ? new Date(input.targetDate) : null;
  if (input.progress !== undefined) patch.progress = input.progress;
  if (input.position !== undefined) patch.position = input.position;
  await db.update(releases).set(patch).where(eq(releases.id, id));
  return { id };
}

export async function deleteRelease(actor: Actor, id: string) {
  await requirePerm(actor, 'products', 'write');
  const [existing] = await db
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.companyId, actor.companyId), eq(releases.id, id)))
    .limit(1);
  if (!existing) throw new ApiException('RELEASE_NOT_FOUND');
  await clearSubtreeAssignments(actor.companyId, 'release', id);
  await db.delete(releases).where(eq(releases.id, id));
  return { id };
}
