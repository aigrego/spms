import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { productLines, products, releases } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { nextKey } from '@/lib/keys';
import { assignMember, clearSubtreeAssignments } from '@/lib/assignments';
import type { Actor } from './types';

/* Lifecycle catalog business service: 产品线 → 产品 → 版本/Release.
   Ported from apps/spms-server/src/routes/catalog.ts (tenant scoping removed;
   key allocation now via the counters table). Entities are addressed by their
   uuid `id`, resolved on the frontend via the bootstrap maps. */

type ProductRow = typeof products.$inferSelect;
export type ProductStatus = ProductRow['status'];
type ReleaseRow = typeof releases.$inferSelect;
export type ReleaseStatus = ReleaseRow['status'];
export type LifecyclePhase = ReleaseRow['phase'];

/* ============================ Product lines ============================ */

export async function listProductLines() {
  return db.select().from(productLines).orderBy(asc(productLines.position));
}

export interface CreateProductLineInput {
  name: string;
  description?: string | null;
  color?: string;
  position?: number;
}

export async function createProductLine(input: CreateProductLineInput) {
  if (!input.name.trim()) throw new ApiException('VALIDATION_FAILED', '名称不能为空');
  const id = crypto.randomUUID();
  const key = await nextKey('PL');
  await db.insert(productLines).values({
    id,
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

export async function updateProductLine(id: string, input: UpdateProductLineInput) {
  const [existing] = await db
    .select({ id: productLines.id })
    .from(productLines)
    .where(eq(productLines.id, id))
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

export async function deleteProductLine(id: string) {
  const [existing] = await db
    .select({ id: productLines.id })
    .from(productLines)
    .where(eq(productLines.id, id))
    .limit(1);
  if (!existing) throw new ApiException('PRODUCT_LINE_NOT_FOUND');
  // Clear virtual-team rows across the whole subtree before the cascade delete.
  const childProducts = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.productLineId, id));
  for (const p of childProducts) {
    await clearSubtreeAssignments('product', p.id);
  }
  await db.delete(productLines).where(eq(productLines.id, id));
  return { id };
}

/* =============================== Products =============================== */

export async function listProducts(filter?: { line?: string }) {
  const conds = [];
  if (filter?.line) conds.push(eq(products.productLineId, filter.line));
  return db
    .select()
    .from(products)
    .where(conds.length ? and(...conds) : undefined)
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
  if (!input.name.trim()) throw new ApiException('VALIDATION_FAILED', '名称不能为空');
  const [line] = await db
    .select({ id: productLines.id })
    .from(productLines)
    .where(eq(productLines.id, input.productLineId))
    .limit(1);
  if (!line) throw new ApiException('PRODUCT_LINE_NOT_FOUND');
  const id = crypto.randomUUID();
  const key = await nextKey('PD');
  await db.insert(products).values({
    id,
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
  if (input.leadId) await assignMember('product', id, input.leadId, 'lead', actor.memberId);
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
  const [existing] = await db.select({ id: products.id }).from(products).where(eq(products.id, id)).limit(1);
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
  if (input.leadId) await assignMember('product', id, input.leadId, 'lead', actor.memberId);
  return { id };
}

export async function deleteProduct(id: string) {
  const [existing] = await db.select({ id: products.id }).from(products).where(eq(products.id, id)).limit(1);
  if (!existing) throw new ApiException('PRODUCT_NOT_FOUND');
  await clearSubtreeAssignments('product', id);
  await db.delete(products).where(eq(products.id, id));
  return { id };
}

/* =============================== Releases =============================== */

export async function listReleases(filter?: { product?: string }) {
  const conds = [];
  if (filter?.product) conds.push(eq(releases.productId, filter.product));
  return db
    .select()
    .from(releases)
    .where(conds.length ? and(...conds) : undefined)
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

export async function createRelease(input: CreateReleaseInput) {
  if (!input.name.trim()) throw new ApiException('VALIDATION_FAILED', '版本名称不能为空');
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);
  if (!product) throw new ApiException('PRODUCT_NOT_FOUND');
  const id = crypto.randomUUID();
  const key = await nextKey('RL');
  await db.insert(releases).values({
    id,
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

export async function updateRelease(id: string, input: UpdateReleaseInput) {
  const [existing] = await db.select({ id: releases.id }).from(releases).where(eq(releases.id, id)).limit(1);
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

export async function deleteRelease(id: string) {
  const [existing] = await db.select({ id: releases.id }).from(releases).where(eq(releases.id, id)).limit(1);
  if (!existing) throw new ApiException('RELEASE_NOT_FOUND');
  await clearSubtreeAssignments('release', id);
  await db.delete(releases).where(eq(releases.id, id));
  return { id };
}
