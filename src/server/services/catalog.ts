import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { productLines, products, projects, releases, sprints, issues } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { nextKey } from '@/lib/keys';
import { assignMember, clearNodesAssignments, sprintsDyingWithProjects, type NodeRef } from '@/lib/assignments';
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

/* drizzle 事务句柄(db.transaction 回调参数),供须入事务的私有 helper 使用。 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
  // Clear virtual-team rows + dying sprints across the whole subtree before the
  // cascade delete (shared sprints survive minus their links). 指派清理在事务外
  // (lib helper 用全局 db);垂死迭代与产品线行的删除收进一个事务 ——
  // products/releases/projects 行由 productLines 删除的 FK 级联带走。
  //
  // 原为逐产品串行处理(N+1),现按产品线一次批量:项目/版本各一条查询;垂死迭代
  // 按「项目集合整体随产品线删除」判定 —— 横跨同线多个产品的共享迭代随产品线
  // 一起删除(逐产品判定时它会作为 0 项目的空壳残留)。
  const childProducts = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.companyId, actor.companyId), eq(products.productLineId, id)));
  const productIds = childProducts.map((p) => p.id);
  const [projRows, relRows] = productIds.length
    ? await Promise.all([
        db
          .select({ id: projects.id })
          .from(projects)
          .innerJoin(releases, eq(projects.releaseId, releases.id))
          .where(and(eq(projects.companyId, actor.companyId), inArray(releases.productId, productIds))),
        db
          .select({ id: releases.id })
          .from(releases)
          .where(and(eq(releases.companyId, actor.companyId), inArray(releases.productId, productIds))),
      ])
    : [[], []];
  const dyingSprintIds = await sprintsDyingWithProjects(
    actor.companyId,
    projRows.map((r) => r.id),
  );
  await clearNodesAssignments(actor.companyId, [
    ...productIds.map((pid): NodeRef => ({ nodeType: 'product', nodeId: pid })),
    ...relRows.map((r): NodeRef => ({ nodeType: 'release', nodeId: r.id })),
    ...projRows.map((r): NodeRef => ({ nodeType: 'project', nodeId: r.id })),
    ...dyingSprintIds.map((sid): NodeRef => ({ nodeType: 'sprint', nodeId: sid })),
  ]);
  await db.transaction(async (tx) => {
    await deleteSubtreeSprints(tx, actor.companyId, dyingSprintIds);
    await tx.delete(productLines).where(eq(productLines.id, id));
  });
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

/* Projects under a product (via its releases). */
async function projectIdsOfProduct(companyId: string, productId: string): Promise<string[]> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(releases, eq(projects.releaseId, releases.id))
    .where(and(eq(projects.companyId, companyId), eq(releases.productId, productId)));
  return rows.map((r) => r.id);
}

/* Projects directly under a release. */
async function projectIdsOfRelease(companyId: string, releaseId: string): Promise<string[]> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.companyId, companyId), eq(projects.releaseId, releaseId)));
  return rows.map((r) => r.id);
}

/* Shared delete walk for product/release: clear the polymorphic assignment rows
   of the dying nodes, then return the sprints that die with the subtree (all
   their projects inside it) — shared sprints survive minus the links.
   extraRefs: 同批清理的其它指派节点(如产品下的 release 行),合并进同一条删除。

   两阶段约定:指派清理(clearNodesAssignments,lib helper 内部用全局 db)留在
   事务外、维持原有先后;垂死迭代的行删除由 deleteSubtreeSprints 在调用方的
   事务里做。若事务失败,代价是存活节点少了指派行(可重新指派),而非半截删除。 */
async function clearLifecycleSubtree(
  actor: Actor,
  node: NodeRef & { nodeType: 'product' | 'release' },
  projectIds: string[],
  extraRefs: NodeRef[] = [],
): Promise<string[]> {
  const companyId = actor.companyId;
  const dyingSprints = await sprintsDyingWithProjects(companyId, projectIds);
  // 指派行清理合并为一条按类型分组的删除(原为逐节点 clearNodeAssignments,N+1)。
  await clearNodesAssignments(companyId, [
    node,
    ...projectIds.map((pid): NodeRef => ({ nodeType: 'project', nodeId: pid })),
    ...dyingSprints.map((sid): NodeRef => ({ nodeType: 'sprint', nodeId: sid })),
    ...extraRefs,
  ]);
  return dyingSprints;
}

/* 垂死迭代的行删除(在调用方的事务里执行):显式 detach issue(house style;
   FK 也是 set null),再删迭代行 —— snapshots/join rows 由 FK 级联。 */
async function deleteSubtreeSprints(tx: Tx, companyId: string, dyingSprintIds: string[]) {
  if (!dyingSprintIds.length) return;
  await tx
    .update(issues)
    .set({ sprintId: null })
    .where(and(eq(issues.companyId, companyId), inArray(issues.sprintId, dyingSprintIds)));
  await tx.delete(sprints).where(and(eq(sprints.companyId, companyId), inArray(sprints.id, dyingSprintIds)));
}

/* Shared per-product delete walk: clear assignment rows of the product subtree
   nodes, but NOT the product row itself. 返回垂死迭代 id,供调用方事务删除。 */
async function clearProductSubtree(actor: Actor, productId: string): Promise<string[]> {
  const companyId = actor.companyId;
  // 项目与版本各一条查询(原为逐 release 再清理),release 指派行经 extraRefs 合并清理。
  const [projectIds, releaseRows] = await Promise.all([
    projectIdsOfProduct(companyId, productId),
    db
      .select({ id: releases.id })
      .from(releases)
      .where(and(eq(releases.companyId, companyId), eq(releases.productId, productId))),
  ]);
  return clearLifecycleSubtree(
    actor,
    { nodeType: 'product', nodeId: productId },
    projectIds,
    releaseRows.map((r): NodeRef => ({ nodeType: 'release', nodeId: r.id })),
  );
}

export async function deleteProduct(actor: Actor, id: string) {
  await requirePerm(actor, 'products', 'write');
  const [existing] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.companyId, actor.companyId), eq(products.id, id)))
    .limit(1);
  if (!existing) throw new ApiException('PRODUCT_NOT_FOUND');
  const dyingSprintIds = await clearProductSubtree(actor, id);
  // 垂死迭代与产品行的删除同生同灭(releases/projects 由 FK 级联)。
  await db.transaction(async (tx) => {
    await deleteSubtreeSprints(tx, actor.companyId, dyingSprintIds);
    await tx.delete(products).where(eq(products.id, id));
  });
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

/* targetDate 双层防御:REST 路由层 zod 已拦掉非法日期字符串,服务层(MCP 等
   直连调用方不过 zod)再兜一次 isNaN。 */
function parseTargetDate(v: Date | string): Date {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(+d)) throw new ApiException('VALIDATION_FAILED', 'targetDate 不是合法日期');
  return d;
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
    targetDate: input.targetDate ? parseTargetDate(input.targetDate) : null,
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
  if (input.targetDate !== undefined) patch.targetDate = input.targetDate ? parseTargetDate(input.targetDate) : null;
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
  const dyingSprintIds = await clearLifecycleSubtree(
    actor,
    { nodeType: 'release', nodeId: id },
    await projectIdsOfRelease(actor.companyId, id),
  );
  // 垂死迭代与版本行的删除同生同灭(projects 由 FK 级联)。
  await db.transaction(async (tx) => {
    await deleteSubtreeSprints(tx, actor.companyId, dyingSprintIds);
    await tx.delete(releases).where(eq(releases.id, id));
  });
  return { id };
}
