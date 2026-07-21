import { db } from '@/db';
import { rolePermissions } from '@/db/schema';
import { ApiException } from './envelope';

/* Per-company module access control (multi-company sandbox).

   Two role layers:
     - users.role               platform-level ('admin' = 平台管理员)
     - company_memberships.role company-level ('company_admin' + the four
                                configurable roles below)

   The configurable matrix lives in `role_permissions` (4 roles × 10 modules,
   seeded by scripts/seed.ts). Two scopes: companyId '' = 全局默认;非空 =
   该公司对全局的按单元格覆盖(公司行覆盖全局行)。company_admin and
   platform admins are implicit full access and are intentionally NOT in the
   matrix. */

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
] as const;
export type Module = (typeof MODULES)[number];

export const CONFIGURABLE_ROLES = ['product_manager', 'developer', 'tester', 'viewer'] as const;
export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number];

export const LEVELS = ['none', 'read', 'write'] as const;
export type Level = (typeof LEVELS)[number];

export type Matrix = Record<ConfigurableRole, Record<Module, Level>>;

const LEVEL_RANK: Record<Level, number> = { none: 0, read: 1, write: 2 };

function emptyMatrix(): Matrix {
  // Deny by default: any (role, module) pair missing from the table → 'none'.
  const m = {} as Record<string, Record<string, Level>>;
  for (const role of CONFIGURABLE_ROLES) {
    m[role] = {} as Record<string, Level>;
    for (const mod of MODULES) m[role][mod] = 'none';
  }
  return m as Matrix;
}

/* Matrices are read on every permission check — cache per scope in-process
   for 60s. Key: '' = 全局默认;否则 companyId(已合并全局行)。 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; matrix: Matrix }>();

export function invalidateMatrixCache(companyId?: string): void {
  if (companyId === undefined) cache.clear();
  else cache.delete(companyId);
}

/* Effective matrix for a scope: global rows (''), overlaid cell-by-cell with
   the company's own rows when companyId is given. */
export async function getMatrix(companyId?: string): Promise<Matrix> {
  const key = companyId ?? '';
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.matrix;

  const rows = await db
    .select({ companyId: rolePermissions.companyId, role: rolePermissions.role, module: rolePermissions.module, level: rolePermissions.level })
    .from(rolePermissions);
  const matrix = emptyMatrix();
  const apply = (scope: string) => {
    for (const r of rows) {
      if (r.companyId !== scope) continue;
      if (!(CONFIGURABLE_ROLES as readonly string[]).includes(r.role)) continue;
      if (!(MODULES as readonly string[]).includes(r.module)) continue;
      if (!(LEVELS as readonly string[]).includes(r.level)) continue;
      matrix[r.role as ConfigurableRole][r.module as Module] = r.level as Level;
    }
  };
  apply('');
  if (companyId) apply(companyId);
  cache.set(key, { at: now, matrix });
  return matrix;
}

/* Effective level of a company role on a module. company_admin is constant
   full access (not stored in the matrix); unknown roles fall back to 'none'. */
export async function levelFor(companyRole: string | null | undefined, module: Module, companyId?: string): Promise<Level> {
  if (companyRole === 'company_admin') return 'write';
  if (!companyRole || !(CONFIGURABLE_ROLES as readonly string[]).includes(companyRole)) return 'none';
  const matrix = await getMatrix(companyId);
  return matrix[companyRole as ConfigurableRole][module];
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
export async function requirePerm(actor: PermActor, module: Module, need: 'read' | 'write'): Promise<void> {
  if (actor.isPlatformAdmin || actor.companyRole === 'company_admin') return;
  const level = await levelFor(actor.companyRole, module, actor.companyId);
  if (LEVEL_RANK[level] < LEVEL_RANK[need]) {
    throw new ApiException('FORBIDDEN', '没有该模块的访问权限', 403);
  }
}

/* The actor's effective level on every module — served to the frontend (e.g.
   via /api/auth/session) so it can hide/disable modules the actor cannot use.
   Admins get 'write' on everything. */
export async function permsForActor(actor: PermActor): Promise<Record<Module, Level>> {
  const out = {} as Record<Module, Level>;
  if (actor.isPlatformAdmin || actor.companyRole === 'company_admin') {
    for (const m of MODULES) out[m] = 'write';
    return out;
  }
  const matrix = await getMatrix(actor.companyId);
  for (const m of MODULES) {
    out[m] =
      actor.companyRole && (CONFIGURABLE_ROLES as readonly string[]).includes(actor.companyRole)
        ? matrix[actor.companyRole as ConfigurableRole][m]
        : 'none';
  }
  return out;
}
