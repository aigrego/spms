import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { products, projects, releases, resourceAssignments, sprints, sprintProjects } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
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

/* visibleSetsFor 的结果按 (companyId, memberId) 进程内缓存 60s(与 permissions
   矩阵缓存同款写法):每次判定要拉 6 张全表,而可见性变化的传播延迟可接受 ——
   新建节点对未指派者本就不可见(fail-closed),已删节点的残留 id 命中不到行、
   不放大可见面;唯一敏感方向是「撤销指派」,由 @/lib/assignments 的写路径调用
   invalidateVisibilityCache 即时清掉该公司条目。
   注意:serverless / 多实例部署下各实例缓存互不可见,失效只清当前实例,
   其余实例等 TTL 自然过期(与 permissions 缓存同一前提)。 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; sets: VisibleSets }>();

export function invalidateVisibilityCache(companyId?: string): void {
  if (companyId === undefined) {
    cache.clear();
    return;
  }
  for (const k of cache.keys()) if (k.startsWith(`${companyId}:`)) cache.delete(k);
}

export async function visibleSetsFor(actor: Actor): Promise<VisibleSets | null> {
  if (actor.isPlatformAdmin || actor.companyRole === 'company_admin') return null;
  if (!actor.memberId) return EMPTY;
  const companyId = actor.companyId;

  const cacheKey = `${companyId}:${actor.memberId}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.sets;

  const sets = await computeVisibleSets(companyId, actor.memberId);
  cache.set(cacheKey, { at: Date.now(), sets });
  return sets;
}

async function computeVisibleSets(companyId: string, memberId: string): Promise<VisibleSets> {
  const [direct, projectRows, releaseRows, sprintRows, sprintProjectRows, productRows] = await Promise.all([
    db
      .select({ nodeType: resourceAssignments.nodeType, nodeId: resourceAssignments.nodeId })
      .from(resourceAssignments)
      .where(
        and(
          eq(resourceAssignments.companyId, companyId),
          eq(resourceAssignments.memberId, memberId),
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

/* 单条项目可见性判定（写路径共用；读单条按「不存在」处理，换项目则显式 403）:
   1) 令牌项目白名单(无项目的资源也不可见);
   2) 指派可见性(visibleSetsFor;无项目的资源视为公司级放行)。
   注意:本模块不得 import 任何 services,避免循环依赖。 */
export async function issueVisible(actor: Actor, projectId: string | null): Promise<boolean> {
  if (actor.allowedProjectIds && (!projectId || !actor.allowedProjectIds.includes(projectId))) return false;
  if (!projectId) return true;
  const visible = await visibleSetsFor(actor);
  return !visible || visible.projectIds.includes(projectId);
}

/* 写路径门槛:项目不在可见范围内 → 403(与 issueVisible 的 NOT_FOUND 语义互补,
   用于 create / 改入新项目等「目标项目」场景)。 */
export async function assertProjectWritable(actor: Actor, projectId: string | null) {
  if (!(await issueVisible(actor, projectId))) {
    throw new ApiException('FORBIDDEN', '该项目不在你的可见范围内', 403);
  }
}
