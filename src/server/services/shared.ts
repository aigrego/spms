import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { projects, requirements } from '@/db/schema';
import { ApiException } from '@/lib/envelope';

/* Service 层共享小工具(TKT-255):各域 service 共用的常量、drizzle 关联片段与
   解析 helper。本模块只依赖 db/schema/envelope 等叶子模块,不 import 任何兄弟
   service —— testruns 的发布门禁曾被 catalog import、catalog 又被 testruns 需要
   projectIdsOfRelease,抽到这里即解开这个"为避循环依赖而本地拷贝"的结。 */

/* drizzle 事务句柄(db.transaction 回调参数),供须入事务的私有 helper 使用。 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/* 列表服务端上限:内存保护,超出按各域现有排序截断;不加分页参数、不改响应形状。
   issues 放宽到 1000(前端「全部 Issues」视图依赖接近全量的列表);test runs 100;
   其余域 500。 */
export const LIST_LIMIT = 500;
export const ISSUE_LIST_LIMIT = 1000;
export const TEST_RUN_LIST_LIMIT = 100;

/* issue 列表/详情的通用关联(issues 与 sprints/backlog 共用)。 */
export const withRelations = {
  issueLabels: { with: { label: true } },
  subIssues: true,
  requirement: { columns: { key: true } },
} as const;

/* 测试用例的需求/工单展示 key 关联(testcases 与 testruns 共用)。 */
export const withLinks = {
  requirement: { columns: { key: true } },
  issue: { columns: { key: true } },
} as const;

/* Resolve a requirement display key (FR-N / NFR-N) → internal uuid, within the
   company. Returns null for an empty key; undefined when provided but not found. */
export async function resolveRequirementId(companyId: string, key: string | null | undefined) {
  if (!key) return null;
  const [r] = await db
    .select({ id: requirements.id })
    .from(requirements)
    .where(and(eq(requirements.companyId, companyId), eq(requirements.key, key)))
    .limit(1);
  return r?.id ?? undefined;
}

/* Projects directly under a release. */
export async function projectIdsOfRelease(companyId: string, releaseId: string): Promise<string[]> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.companyId, companyId), eq(projects.releaseId, releaseId)));
  return rows.map((r) => r.id);
}

/* 日期入参双层防御:REST 路由层 zod 已拦掉非法日期字符串,服务层(MCP 等直连
   调用方不过 zod)再兜一次 isNaN。 */
export function parseDate(v: Date | string, field: string): Date {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(+d)) throw new ApiException('VALIDATION_FAILED', `${field} 不是合法日期`);
  return d;
}
