import { createHash, randomBytes } from 'node:crypto';
import { and, asc, count, eq } from 'drizzle-orm';
import { db } from '@/db';
import { companies, companyMemberships, mcpApiKeys, rolePermissions, users } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { hashPassword } from '@/lib/password';
import {
  CONFIGURABLE_ROLES,
  MODULES,
  LEVELS,
  getMatrix,
  invalidateMatrixCache,
  type Matrix,
} from '@/lib/permissions';
import type { Actor } from './types';

/* Platform-admin business service (multi-company sandbox): company CRUD,
   per-company membership management, the global role-permission matrix, and
   MCP API keys. Every function is platform-admin only — checked INSIDE the
   service (routes build the actor via requireActor; MCP must never call this
   module with a non-admin actor). */

// The 5 built-in company roles: company_admin + the 4 configurable ones.
export const COMPANY_ROLES = ['company_admin', ...CONFIGURABLE_ROLES] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

function requirePlatformAdmin(actor: Actor): void {
  if (!actor.isPlatformAdmin) throw new ApiException('FORBIDDEN', '需要平台管理员权限', 403);
}

function assertCompanyRole(role: string): asserts role is CompanyRole {
  if (!(COMPANY_ROLES as readonly string[]).includes(role)) {
    throw new ApiException('VALIDATION_FAILED', `role 必须是内置角色之一（${COMPANY_ROLES.join(' / ')}）`);
  }
}

async function companyExists(id: string): Promise<boolean> {
  const [c] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id)).limit(1);
  return !!c;
}

/* =============================== Companies =============================== */

/* ---- all companies + their membership counts (oldest first) ---- */
export async function listCompanies(actor: Actor) {
  requirePlatformAdmin(actor);
  const rows = await db
    .select({ company: companies, memberCount: count(companyMemberships.id) })
    .from(companies)
    .leftJoin(companyMemberships, eq(companyMemberships.companyId, companies.id))
    .groupBy(companies.id)
    .orderBy(asc(companies.createdAt));
  return rows.map((r) => ({ ...r.company, memberCount: r.memberCount }));
}

export interface CreateCompanyInput {
  key: string;
  name: string;
  color?: string | null;
  description?: string | null;
}

/* ---- create a company; the creator becomes its company_admin ---- */
export async function createCompany(actor: Actor, input: CreateCompanyInput) {
  requirePlatformAdmin(actor);
  const key = input.key?.trim();
  const name = input.name?.trim();
  if (!key || !name) throw new ApiException('VALIDATION_FAILED', '公司 key 与名称不能为空');

  const [dupe] = await db.select({ id: companies.id }).from(companies).where(eq(companies.key, key)).limit(1);
  if (dupe) throw new ApiException('CONFLICT', `公司 key「${key}」已存在`);

  const id = crypto.randomUUID();
  await db.insert(companies).values({
    id,
    key,
    name,
    color: input.color ?? null,
    description: input.description ?? null,
  });
  // Creator gets a company_admin membership (idempotent — a membership may
  // already exist in exotic replay scenarios).
  await db
    .insert(companyMemberships)
    .values({ id: crypto.randomUUID(), userId: actor.userId, companyId: id, role: 'company_admin' })
    .onConflictDoNothing();

  const [row] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  return row;
}

export interface UpdateCompanyInput {
  name?: string;
  color?: string | null;
  description?: string | null;
}

/* ---- update a company's display fields (key is immutable) ---- */
export async function updateCompany(actor: Actor, id: string, patch: UpdateCompanyInput) {
  requirePlatformAdmin(actor);
  if (!(await companyExists(id))) throw new ApiException('NOT_FOUND', '公司不存在');
  const set: Partial<typeof companies.$inferInsert> = {};
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new ApiException('VALIDATION_FAILED', '公司名称不能为空');
    set.name = patch.name.trim();
  }
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.description !== undefined) set.description = patch.description;
  if (Object.keys(set).length) await db.update(companies).set(set).where(eq(companies.id, id));
  return { id };
}

/* ============================ Company members ============================ */

/* ---- a company's memberships joined with the users row ---- */
export async function listMembers(actor: Actor, companyId: string) {
  requirePlatformAdmin(actor);
  return db
    .select({
      id: companyMemberships.id,
      userId: users.id,
      username: users.username,
      name: users.name,
      role: companyMemberships.role,
      createdAt: companyMemberships.createdAt,
    })
    .from(companyMemberships)
    .innerJoin(users, eq(companyMemberships.userId, users.id))
    .where(eq(companyMemberships.companyId, companyId))
    .orderBy(asc(companyMemberships.createdAt));
}

export interface AddMemberInput {
  username: string;
  role: CompanyRole;
  name?: string;
  password?: string; // initial password — required when the username is new
}

/* ---- add a user to a company ----
   Existing username → membership only (already a member → INVITE_FAILED).
   New username + password → the login account is created on the fly
   (name defaults to username, platform role 'member'). New username without a
   password → VALIDATION_FAILED. */
export async function addMember(actor: Actor, companyId: string, input: AddMemberInput) {
  requirePlatformAdmin(actor);
  if (!(await companyExists(companyId))) throw new ApiException('NOT_FOUND', '公司不存在');
  const username = input.username?.trim();
  if (!username) throw new ApiException('VALIDATION_FAILED', '用户名不能为空');
  assertCompanyRole(input.role);

  let [u] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (!u) {
    if (!input.password) throw new ApiException('VALIDATION_FAILED', '用户不存在且未提供初始密码');
    const userId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      username,
      passwordHash: await hashPassword(input.password),
      name: input.name?.trim() || username,
      role: 'member',
    });
    [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  }

  const [dupe] = await db
    .select({ id: companyMemberships.id })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.userId, u.id), eq(companyMemberships.companyId, companyId)))
    .limit(1);
  if (dupe) throw new ApiException('INVITE_FAILED', '该用户已是公司成员');

  const id = crypto.randomUUID();
  await db.insert(companyMemberships).values({ id, userId: u.id, companyId, role: input.role });
  return { id, userId: u.id, username: u.username, name: u.name, role: input.role };
}

/* ---- change a membership's company role ---- */
export async function updateMemberRole(actor: Actor, companyId: string, membershipId: string, role: CompanyRole) {
  requirePlatformAdmin(actor);
  assertCompanyRole(role);
  const [m] = await db
    .select({ id: companyMemberships.id })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.id, membershipId), eq(companyMemberships.companyId, companyId)))
    .limit(1);
  if (!m) throw new ApiException('MEMBER_NOT_FOUND', '成员不存在');
  await db.update(companyMemberships).set({ role }).where(eq(companyMemberships.id, membershipId));
  return { id: membershipId, role };
}

/* ---- remove a membership (the user account itself survives) ---- */
export async function removeMember(actor: Actor, companyId: string, membershipId: string) {
  requirePlatformAdmin(actor);
  const [m] = await db
    .select({ id: companyMemberships.id })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.id, membershipId), eq(companyMemberships.companyId, companyId)))
    .limit(1);
  if (!m) throw new ApiException('MEMBER_NOT_FOUND', '成员不存在');
  await db.delete(companyMemberships).where(eq(companyMemberships.id, membershipId));
  return { id: membershipId };
}

/* ========================= Role permission matrix ========================= */

/* ---- the full 4 roles × 10 modules matrix (every cell has a value) ---- */
export async function getPermissionsMatrix(actor: Actor) {
  requirePlatformAdmin(actor);
  return { roles: CONFIGURABLE_ROLES, modules: MODULES, matrix: await getMatrix() };
}

/* ---- replace the matrix: validate every cell, upsert, then bust the cache ---- */
export async function savePermissionsMatrix(actor: Actor, matrix: Matrix) {
  requirePlatformAdmin(actor);
  for (const role of CONFIGURABLE_ROLES) {
    const row = matrix[role];
    if (!row) throw new ApiException('VALIDATION_FAILED', `缺少角色 ${role} 的权限配置`);
    for (const mod of MODULES) {
      const level = row[mod];
      if (!level || !(LEVELS as readonly string[]).includes(level)) {
        throw new ApiException('VALIDATION_FAILED', `权限档位不合法（${role}.${mod}）`);
      }
    }
  }
  for (const role of CONFIGURABLE_ROLES) {
    for (const mod of MODULES) {
      await db
        .insert(rolePermissions)
        .values({ role, module: mod, level: matrix[role][mod] })
        .onConflictDoUpdate({
          target: [rolePermissions.role, rolePermissions.module],
          set: { level: matrix[role][mod] },
        });
    }
  }
  invalidateMatrixCache();
  return { roles: CONFIGURABLE_ROLES, modules: MODULES, matrix: await getMatrix() };
}

/* =============================== MCP API keys =============================== */

/* ---- all MCP keys (+ company name; NULL company = platform scope). keyHash
   is never returned. ---- */
export async function listMcpKeys(actor: Actor) {
  requirePlatformAdmin(actor);
  return db
    .select({
      id: mcpApiKeys.id,
      prefix: mcpApiKeys.prefix,
      name: mcpApiKeys.name,
      companyId: mcpApiKeys.companyId,
      companyName: companies.name,
      createdBy: mcpApiKeys.createdBy,
      revokedAt: mcpApiKeys.revokedAt,
      createdAt: mcpApiKeys.createdAt,
    })
    .from(mcpApiKeys)
    .leftJoin(companies, eq(mcpApiKeys.companyId, companies.id))
    .orderBy(asc(mcpApiKeys.createdAt));
}

export interface CreateMcpKeyInput {
  name: string;
  companyId?: string | null; // null/omitted → platform-level key
}

/* ---- mint an MCP key: the plaintext is returned ONCE, only sha256 is stored ---- */
export async function createMcpKey(actor: Actor, input: CreateMcpKeyInput) {
  requirePlatformAdmin(actor);
  const name = input.name?.trim();
  if (!name) throw new ApiException('VALIDATION_FAILED', '名称不能为空');
  const companyId = input.companyId ?? null;
  if (companyId && !(await companyExists(companyId))) throw new ApiException('NOT_FOUND', '公司不存在');

  const key = `spms_${randomBytes(16).toString('hex')}`; // spms_ + 32 hex chars
  const keyHash = createHash('sha256').update(key).digest('hex');
  const prefix = key.slice(0, 8);
  const id = crypto.randomUUID();
  await db.insert(mcpApiKeys).values({ id, keyHash, prefix, name, companyId, createdBy: actor.userId });
  return { id, key, prefix };
}

/* ---- revoke a key (id stays for audit; revokedAt marks it dead) ---- */
export async function revokeMcpKey(actor: Actor, id: string) {
  requirePlatformAdmin(actor);
  const [k] = await db.select({ id: mcpApiKeys.id }).from(mcpApiKeys).where(eq(mcpApiKeys.id, id)).limit(1);
  if (!k) throw new ApiException('NOT_FOUND', 'API Key 不存在');
  await db.update(mcpApiKeys).set({ revokedAt: new Date() }).where(eq(mcpApiKeys.id, id));
  return { id };
}
