import { db } from '@/db';
import { rolePermissions } from '@/db/schema';
import { ApiException } from './envelope';

/* Per-company module access control (multi-company sandbox).

   Two role layers:
     - users.role               platform-level ('admin' = 平台管理员)
     - company_memberships.role company-level ('company_admin' + the four
                                configurable roles below)

   The configurable matrix lives in `role_permissions` (4 roles × N modules,
   seeded by scripts/seed.ts). Two scopes: companyId '' = 全局默认(MODULES);
   非空 = 该公司对全局的按单元格覆盖(公司行覆盖全局行),公司作用域额外多
   COMPANY_ONLY_MODULES(如 Notion 集成,全局作用域没有,缺省 none = 仅
   管理员可见)。company_admin and platform admins are implicit full access
   and are intentionally NOT in the matrix. */

export const MODULES = [
  'issues',
  'products',
  'requirements',
  'testcases',
  'projects',
  'resources',
  'roadmap',
  'backlog',
  'sprints',
  'agents',
  'reports',
] as const;
export type Module = (typeof MODULES)[number];

/* 仅公司作用域存在的模块(不进全局矩阵)。缺省 none,即默认仅
   company_admin / 平台管理员可见,公司可在权限矩阵里按角色放开。 */
export const COMPANY_ONLY_MODULES = ['notion'] as const;
export const COMPANY_MODULES = [...MODULES, ...COMPANY_ONLY_MODULES] as const;
export type CompanyModule = Module | (typeof COMPANY_ONLY_MODULES)[number];

export const CONFIGURABLE_ROLES = ['product_manager', 'developer', 'tester', 'viewer'] as const;
export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number];

export const LEVELS = ['none', 'read', 'write'] as const;
export type Level = (typeof LEVELS)[number];

export type Matrix = Record<ConfigurableRole, Record<Module, Level>>;
export type CompanyMatrix = Record<ConfigurableRole, Record<CompanyModule, Level>>;

const LEVEL_RANK: Record<Level, number> = { none: 0, read: 1, write: 2 };

function emptyMatrix(mods: readonly string[]): Record<ConfigurableRole, Record<string, Level>> {
  // Deny by default: any (role, module) pair missing from the table → 'none'.
  const m = {} as Record<string, Record<string, Level>>;
  for (const role of CONFIGURABLE_ROLES) {
    m[role] = {} as Record<string, Level>;
    for (const mod of mods) m[role][mod] = 'none';
  }
  return m as Record<ConfigurableRole, Record<string, Level>>;
}

/* Matrices are read on every permission check — cache per scope in-process
   for 60s. Key: '' = 全局默认;否则 companyId(已合并全局行,含公司专属模块)。 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; matrix: Record<ConfigurableRole, Record<string, Level>> }>();

export function invalidateMatrixCache(companyId?: string): void {
  if (companyId === undefined) cache.clear();
  else cache.delete(companyId);
}

/* Effective matrix for a scope: global rows (''), overlaid cell-by-cell with
   the company's own rows when companyId is given. 公司作用域用 COMPANY_MODULES
   (含 notion 等公司专属模块,全局行天然缺席,缺省 none);全局作用域用 MODULES。 */
export async function getMatrix(): Promise<Matrix>;
export async function getMatrix(companyId: string): Promise<CompanyMatrix>;
export async function getMatrix(companyId?: string): Promise<Matrix | CompanyMatrix> {
  const key = companyId ?? '';
  const mods: readonly string[] = companyId ? COMPANY_MODULES : MODULES;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.matrix as Matrix | CompanyMatrix;

  const rows = await db
    .select({ companyId: rolePermissions.companyId, role: rolePermissions.role, module: rolePermissions.module, level: rolePermissions.level })
    .from(rolePermissions);
  const matrix = emptyMatrix(mods);
  const apply = (scope: string) => {
    for (const r of rows) {
      if (r.companyId !== scope) continue;
      if (!(CONFIGURABLE_ROLES as readonly string[]).includes(r.role)) continue;
      if (!mods.includes(r.module)) continue;
      if (!(LEVELS as readonly string[]).includes(r.level)) continue;
      matrix[r.role as ConfigurableRole][r.module] = r.level as Level;
    }
  };
  apply('');
  if (companyId) apply(companyId);
  cache.set(key, { at: now, matrix });
  return matrix as Matrix | CompanyMatrix;
}

/* Effective level of a company role on a module. company_admin is constant
   full access (not stored in the matrix); unknown roles fall back to 'none'. */
export async function levelFor(companyRole: string | null | undefined, module: CompanyModule, companyId?: string): Promise<Level> {
  if (companyRole === 'company_admin') return 'write';
  if (!companyRole || !(CONFIGURABLE_ROLES as readonly string[]).includes(companyRole)) return 'none';
  const matrix = companyId ? await getMatrix(companyId) : await getMatrix();
  return (matrix as CompanyMatrix)[companyRole as ConfigurableRole][module] ?? 'none';
}

/* The fields a permission check needs — structurally satisfied by the
   services-layer Actor (userId/memberId/name/... are irrelevant here). */
export interface PermActor {
  companyRole: string | null;
  isPlatformAdmin: boolean;
  companyId?: string;
}

/* Gate: throws ApiException FORBIDDEN (403) when the actor's effective level
   on `module` is below `need`. Platform admins and company_admins pass
   unconditionally; level 'none' fails even a 'read' check. */
export async function requirePerm(actor: PermActor, module: CompanyModule, need: 'read' | 'write'): Promise<void> {
  if (actor.isPlatformAdmin || actor.companyRole === 'company_admin') return;
  const level = await levelFor(actor.companyRole, module, actor.companyId);
  if (LEVEL_RANK[level] < LEVEL_RANK[need]) {
    throw new ApiException('FORBIDDEN', '没有该模块的访问权限', 403);
  }
}

/* The actor's effective level on every module — served to the frontend (e.g.
   via /api/auth/session) so it can hide/disable modules the actor cannot use.
   Admins get 'write' on everything. */
export async function permsForActor(actor: PermActor): Promise<Record<CompanyModule, Level>> {
  const out = {} as Record<CompanyModule, Level>;
  if (actor.isPlatformAdmin || actor.companyRole === 'company_admin') {
    for (const m of COMPANY_MODULES) out[m] = 'write';
    return out;
  }
  const matrix = actor.companyId ? await getMatrix(actor.companyId) : await getMatrix();
  for (const m of COMPANY_MODULES) {
    out[m] =
      actor.companyRole && (CONFIGURABLE_ROLES as readonly string[]).includes(actor.companyRole)
        ? ((matrix as CompanyMatrix)[actor.companyRole as ConfigurableRole][m] ?? 'none')
        : 'none';
  }
  return out;
}
