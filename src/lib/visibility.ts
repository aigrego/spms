import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { products, projects, releases, resourceAssignments, sprints, sprintProjects } from '@/db/schema';
import type { Actor } from '@/server/services/types';

/* 按研发资源指派(resource_assignments 的 direct 行)的可见性模型。

   规则:project/sprint 可见性只看自身(及有限的上下一跳)的 direct 指派,
   祖先(product/release)direct 不下放——产品/版本级成员不会自动看到其下
   项目的 issue,项目需单独指派。保留的两个例外均服务于导航与协作:
   加入 sprint → 其 project 可见;加入 project → 其下全部 sprint 可见。
   release/product 仍保持祖先下放(product direct → 其 release 可见),作为
   导航壳与需求管理层。

   - 豁免:平台管理员 / company_admin → 返回 null(不限制)。
   - 无 direct 指派的普通成员 → 空集(严格模式:什么都看不到)。
   - 产品线(product_line)不在指派节点内,不在此模型中(列表全可见作导航壳)。
   - projectId 为 NULL 的 issue 视为公司级,不受此模型过滤。 */

export interface VisibleSets {
  productIds: string[];
  releaseIds: string[];
  projectIds: string[];
  sprintIds: string[];
}

const EMPTY: VisibleSets = { productIds: [], releaseIds: [], projectIds: [], sprintIds: [] };

export async function visibleSetsFor(actor: Actor): Promise<VisibleSets | null> {
  if (actor.isPlatformAdmin || actor.companyRole === 'company_admin') return null;
  if (!actor.memberId) return EMPTY;
  const companyId = actor.companyId;

  const [direct, projectRows, releaseRows, sprintRows, sprintProjectRows, productRows] = await Promise.all([
    db
      .select({ nodeType: resourceAssignments.nodeType, nodeId: resourceAssignments.nodeId })
      .from(resourceAssignments)
      .where(
        and(
          eq(resourceAssignments.companyId, companyId),
          eq(resourceAssignments.memberId, actor.memberId),
          eq(resourceAssignments.source, 'direct'),
        ),
      ),
    db
      .select({ id: projects.id, releaseId: projects.releaseId })
      .from(projects)
      .where(eq(projects.companyId, companyId)),
    db
      .select({ id: releases.id, productId: releases.productId })
      .from(releases)
      .where(eq(releases.companyId, companyId)),
    db
      .select({ id: sprints.id })
      .from(sprints)
      .where(eq(sprints.companyId, companyId)),
    db
      .select({ sprintId: sprintProjects.sprintId, projectId: sprintProjects.projectId })
      .from(sprintProjects)
      .where(eq(sprintProjects.companyId, companyId)),
    db.select({ id: products.id }).from(products).where(eq(products.companyId, companyId)),
  ]);
  if (!direct.length) return EMPTY;

  const dProducts = new Set(direct.filter((d) => d.nodeType === 'product').map((d) => d.nodeId));
  const dReleases = new Set(direct.filter((d) => d.nodeType === 'release').map((d) => d.nodeId));
  const dProjects = new Set(direct.filter((d) => d.nodeType === 'project').map((d) => d.nodeId));
  const dSprints = new Set(direct.filter((d) => d.nodeType === 'sprint').map((d) => d.nodeId));

  const projectById = new Map(projectRows.map((p) => [p.id, p]));
  const releaseById = new Map(releaseRows.map((r) => [r.id, r]));

  // 项目:自身 direct,或后代 sprint direct(多项目迭代经 sprint_projects 关联)。
  // 祖先(release/product)direct 不下放。
  const projectIds = new Set<string>();
  for (const p of projectRows) {
    if (dProjects.has(p.id)) projectIds.add(p.id);
  }
  for (const l of sprintProjectRows) {
    if (dSprints.has(l.sprintId)) projectIds.add(l.projectId);
  }

  // 迭代:自身 direct,或(任一)所属 project direct。祖先(release/product)direct 不下放。
  const sprintIds = new Set<string>();
  for (const s of sprintRows) {
    if (dSprints.has(s.id)) sprintIds.add(s.id);
  }
  for (const l of sprintProjectRows) {
    if (dProjects.has(l.projectId)) sprintIds.add(l.sprintId);
  }

  // 版本:自身/祖先 product direct(导航壳与需求管理层保持下放),或可见项目所在版本。
  const releaseIds = new Set<string>();
  for (const r of releaseRows) {
    if (dReleases.has(r.id) || dProducts.has(r.productId)) releaseIds.add(r.id);
  }
  for (const pid of projectIds) {
    const rid = projectById.get(pid)?.releaseId;
    if (rid) releaseIds.add(rid);
  }

  // 产品:自身 direct(防御性过滤掉已不存在的),或后代(可见版本)所在产品。
  const productIds = new Set<string>([...dProducts].filter((id) => productRows.some((p) => p.id === id)));
  for (const rid of releaseIds) {
    const pid = releaseById.get(rid)?.productId;
    if (pid) productIds.add(pid);
  }

  return {
    productIds: [...productIds],
    releaseIds: [...releaseIds],
    projectIds: [...projectIds],
    sprintIds: [...sprintIds],
  };
}

/* 与 MCP 项目白名单(allowedProjectIds)取交集;任一者为 null(不限制)
   时返回另一方。 */
export function clampAllowed(actor: Actor, visibleProjectIds: string[] | null): string[] | null {
  if (!actor.allowedProjectIds) return visibleProjectIds;
  if (!visibleProjectIds) return actor.allowedProjectIds;
  const allow = new Set(actor.allowedProjectIds);
  return visibleProjectIds.filter((id) => allow.has(id));
}
