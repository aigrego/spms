import { createHash, randomBytes } from 'node:crypto';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import { companies, companyMemberships, mcpApiKeys, projects, rolePermissions, users } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { ensureCurrentMember, revokeMemberProjection } from '@/lib/identity';
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
   MCP API keys. Everything except the MCP-key functions is platform-admin only
   — checked INSIDE the service (routes build the actor via requireActor; MCP
   must never call this module with a non-admin actor). MCP keys are
   self-service: members list/create/revoke/delete only their OWN keys, scoped
   to a company they belong to (never platform-level); admins keep full
   visibility. */

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

/* ---- every system user with their company seats (平台成员目录) ---- */
export async function listAllUsers(actor: Actor) {
  requirePlatformAdmin(actor);
  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      name: users.name,
      platformRole: users.role,
      avatarUrl: users.avatarUrl,
      userCreatedAt: users.createdAt,
      membershipId: companyMemberships.id,
      membershipRole: companyMemberships.role,
      companyId: companies.id,
      companyName: companies.name,
      companyColor: companies.color,
    })
    .from(users)
    .leftJoin(companyMemberships, eq(companyMemberships.userId, users.id))
    .leftJoin(companies, eq(companyMemberships.companyId, companies.id))
    .orderBy(asc(users.createdAt), asc(companyMemberships.createdAt));

  const byUser = new Map<
    string,
    {
      userId: string;
      username: string;
      name: string;
      platformRole: string;
      avatarUrl: string | null;
      createdAt: Date;
      seats: { membershipId: string; role: string; companyId: string; companyName: string; companyColor: string | null }[];
    }
  >();
  for (const r of rows) {
    let u = byUser.get(r.userId);
    if (!u) {
      u = {
        userId: r.userId,
        username: r.username,
        name: r.name,
        platformRole: r.platformRole,
        avatarUrl: r.avatarUrl,
        createdAt: r.userCreatedAt,
        seats: [],
      };
      byUser.set(r.userId, u);
    }
    if (r.membershipId && r.companyId && r.companyName) {
      u.seats.push({
        membershipId: r.membershipId,
        role: r.membershipRole ?? 'viewer',
        companyId: r.companyId,
        companyName: r.companyName,
        companyColor: r.companyColor,
      });
    }
  }
  return [...byUser.values()];
}

export interface CreateUserInput {
  username: string;
  name?: string;
  password: string;
}

/* ---- create a bare system account (no seat; seats are assigned per company) ---- */
export async function createUser(actor: Actor, input: CreateUserInput) {
  requirePlatformAdmin(actor);
  const username = input.username?.trim();
  if (!username) throw new ApiException('VALIDATION_FAILED', '用户名不能为空');
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    throw new ApiException('VALIDATION_FAILED', '用户名只能包含字母、数字、_ . -');
  }
  if (!input.password || input.password.length < 6) {
    throw new ApiException('VALIDATION_FAILED', '初始密码至少 6 位');
  }
  const [dupe] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  if (dupe) throw new ApiException('INVITE_FAILED', '用户名已存在');

  const id = crypto.randomUUID();
  const name = input.name?.trim() || username;
  await db.insert(users).values({ id, username, passwordHash: await hashPassword(input.password), name, role: 'member' });
  return { id, username, name };
}

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
  // 席位分配即把用户投影进本公司资源池(幂等),供指派/研发资源使用。
  await ensureCurrentMember({ id: u.id, name: u.name }, companyId);
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

/* ---- remove a membership (the user account survives; their pool projection
   is revoked too so they leave assignee candidate lists) ---- */
export async function removeMember(actor: Actor, companyId: string, membershipId: string) {
  requirePlatformAdmin(actor);
  const [m] = await db
    .select({ id: companyMemberships.id, userId: companyMemberships.userId })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.id, membershipId), eq(companyMemberships.companyId, companyId)))
    .limit(1);
  if (!m) throw new ApiException('MEMBER_NOT_FOUND', '成员不存在');
  await db.delete(companyMemberships).where(eq(companyMemberships.id, membershipId));
  await revokeMemberProjection(companyId, m.userId);
  return { id: membershipId };
}

/* ========================= Role permission matrix ========================= */

function validateMatrix(matrix: Matrix): void {
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
}

async function upsertMatrix(scope: string, matrix: Matrix): Promise<void> {
  for (const role of CONFIGURABLE_ROLES) {
    for (const mod of MODULES) {
      await db
        .insert(rolePermissions)
        .values({ companyId: scope, role, module: mod, level: matrix[role][mod] })
        .onConflictDoUpdate({
          target: [rolePermissions.companyId, rolePermissions.role, rolePermissions.module],
          set: { level: matrix[role][mod] },
        });
    }
  }
}

/* 公司级矩阵的访问门槛:平台管理员,或该公司的 company_admin。 */
function requireCompanyMatrixAccess(actor: Actor, companyId: string): void {
  if (actor.isPlatformAdmin) return;
  if (actor.companyRole === 'company_admin' && actor.companyId === companyId) return;
  throw new ApiException('FORBIDDEN', '需要公司管理员权限', 403);
}

/* ---- the full 4 roles × 10 modules matrix (every cell has a value) ---- */
export async function getPermissionsMatrix(actor: Actor) {
  requirePlatformAdmin(actor);
  return { roles: CONFIGURABLE_ROLES, modules: MODULES, matrix: await getMatrix() };
}

/* ---- replace the GLOBAL default matrix (scope ''): validate, upsert, bust cache ---- */
export async function savePermissionsMatrix(actor: Actor, matrix: Matrix) {
  requirePlatformAdmin(actor);
  validateMatrix(matrix);
  await upsertMatrix('', matrix);
  invalidateMatrixCache();
  return { roles: CONFIGURABLE_ROLES, modules: MODULES, matrix: await getMatrix() };
}

/* ---- a company's effective matrix (global default + 本公司覆盖) ---- */
export async function getCompanyMatrix(actor: Actor, companyId: string) {
  requireCompanyMatrixAccess(actor, companyId);
  if (!(await companyExists(companyId))) throw new ApiException('NOT_FOUND', '公司不存在');
  return { roles: CONFIGURABLE_ROLES, modules: MODULES, matrix: await getMatrix(companyId) };
}

/* ---- replace a company's override matrix ---- */
export async function saveCompanyMatrix(actor: Actor, companyId: string, matrix: Matrix) {
  requireCompanyMatrixAccess(actor, companyId);
  if (!(await companyExists(companyId))) throw new ApiException('NOT_FOUND', '公司不存在');
  validateMatrix(matrix);
  await upsertMatrix(companyId, matrix);
  invalidateMatrixCache(companyId);
  return { roles: CONFIGURABLE_ROLES, modules: MODULES, matrix: await getMatrix(companyId) };
}

/* =============================== MCP API keys =============================== */

/* ---- membership check for member self-service key scoping ---- */
async function isCompanyMember(userId: string, companyId: string): Promise<boolean> {
  const [m] = await db
    .select({ id: companyMemberships.id })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.userId, userId), eq(companyMemberships.companyId, companyId)))
    .limit(1);
  return !!m;
}

/* ---- MCP keys visible to the actor (+ company name + creator/owner names;
   NULL company = platform scope). Admins see all keys; members only their own
   (incl. expired/revoked). keyHash is never returned. ---- */
export async function listMcpKeys(actor: Actor) {
  const owners = alias(users, 'owner');
  const rows = db
    .select({
      id: mcpApiKeys.id,
      prefix: mcpApiKeys.prefix,
      name: mcpApiKeys.name,
      companyId: mcpApiKeys.companyId,
      companyName: companies.name,
      createdBy: mcpApiKeys.createdBy,
      createdByName: users.name,
      ownerId: mcpApiKeys.ownerId,
      ownerName: owners.name,
      capabilities: mcpApiKeys.capabilities,
      projectIds: mcpApiKeys.projectIds,
      expiresAt: mcpApiKeys.expiresAt,
      lastUsedAt: mcpApiKeys.lastUsedAt,
      revokedAt: mcpApiKeys.revokedAt,
      createdAt: mcpApiKeys.createdAt,
    })
    .from(mcpApiKeys)
    .leftJoin(companies, eq(mcpApiKeys.companyId, companies.id))
    .leftJoin(users, eq(mcpApiKeys.createdBy, users.id))
    .leftJoin(owners, eq(mcpApiKeys.ownerId, owners.id))
    .where(actor.isPlatformAdmin ? undefined : eq(mcpApiKeys.createdBy, actor.userId))
    .orderBy(asc(mcpApiKeys.createdAt));
  return rows;
}

export const MCP_CAPABILITIES = ['read', 'write', 'delete'] as const;
export type McpCapability = (typeof MCP_CAPABILITIES)[number];

export interface CreateMcpKeyInput {
  name: string;
  /* Platform admin: null/omitted → platform-level key. Member: omitted →
     their current company; explicit null (platform-level) → 403; any other
     company must be one of their memberships. */
  companyId?: string | null;
  /* 所属人：持 key 调 MCP 时的第一人称身份。默认创建人本人。公司级 key 的
     所属人必须是该公司成员（或平台管理员）；平台级 key 只校验用户存在，
     membership 在每次调用时按目标公司解析。 */
  ownerId?: string;
  capabilities?: McpCapability[]; // default ['read','write']
  expiresInDays?: number | null; // null/omitted → 永不过期
  /* 项目白名单：null/省略 = 全部项目（不限制）；否则只能访问列出的项目
     （至少一个，公司级 key 要求项目属于该公司）。 */
  projectIds?: string[] | null;
}

/* ---- validate the project whitelist: non-empty, all existing, and (for
   company-level keys) inside the key's company ---- */
async function validateProjectIds(companyId: string | null, projectIds: string[]): Promise<void> {
  if (projectIds.length === 0) {
    throw new ApiException('VALIDATION_FAILED', '项目白名单至少选择一个项目，或传 null 表示全部项目');
  }
  const rows = await db
    .select({ id: projects.id, companyId: projects.companyId })
    .from(projects)
    .where(inArray(projects.id, projectIds));
  if (rows.length !== new Set(projectIds).size) {
    throw new ApiException('VALIDATION_FAILED', '项目白名单包含不存在的项目');
  }
  if (companyId && rows.some((p) => p.companyId !== companyId)) {
    throw new ApiException('VALIDATION_FAILED', '项目白名单只能包含该公司下的项目');
  }
}

/* ---- owner validation shared by create/update ---- */
async function validateKeyOwner(companyId: string | null, ownerId: string): Promise<void> {
  const [u] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, ownerId)).limit(1);
  if (!u) throw new ApiException('VALIDATION_FAILED', '所属人用户不存在');
  if (companyId && u.role !== 'admin' && !(await isCompanyMember(ownerId, companyId))) {
    throw new ApiException('VALIDATION_FAILED', '所属人必须是该公司成员');
  }
}

/* ---- mint an MCP key: the plaintext is returned ONCE, only sha256 is stored ---- */
export async function createMcpKey(actor: Actor, input: CreateMcpKeyInput) {
  const name = input.name?.trim();
  if (!name) throw new ApiException('VALIDATION_FAILED', '名称不能为空');

  let companyId: string | null;
  if (actor.isPlatformAdmin) {
    companyId = input.companyId ?? null;
  } else if (input.companyId === undefined) {
    companyId = actor.companyId; // 自助创建默认归属当前公司
  } else if (input.companyId === null) {
    throw new ApiException('FORBIDDEN', '平台级令牌仅平台管理员可创建', 403);
  } else {
    if (!(await isCompanyMember(actor.userId, input.companyId))) {
      throw new ApiException('FORBIDDEN', '只能在自己所属的公司下创建令牌', 403);
    }
    companyId = input.companyId;
  }
  if (companyId && !(await companyExists(companyId))) throw new ApiException('NOT_FOUND', '公司不存在');

  const ownerId = input.ownerId ?? actor.userId;
  await validateKeyOwner(companyId, ownerId);

  const capabilities = input.capabilities ?? ['read', 'write'];
  if (
    capabilities.length === 0 ||
    capabilities.some((c) => !(MCP_CAPABILITIES as readonly string[]).includes(c))
  ) {
    throw new ApiException('VALIDATION_FAILED', '能力只能包含 read/write/delete，且至少一项');
  }
  const expiresInDays = input.expiresInDays ?? null;
  if (expiresInDays != null && (!Number.isInteger(expiresInDays) || expiresInDays < 1)) {
    throw new ApiException('VALIDATION_FAILED', '有效期必须是正整数天数');
  }
  const expiresAt = expiresInDays != null ? new Date(Date.now() + expiresInDays * 86_400_000) : null;

  const projectIds = input.projectIds ?? null;
  if (projectIds) await validateProjectIds(companyId, projectIds);

  const key = `spms_${randomBytes(16).toString('hex')}`; // spms_ + 32 hex chars
  const keyHash = createHash('sha256').update(key).digest('hex');
  const prefix = key.slice(0, 8);
  const id = crypto.randomUUID();
  await db.insert(mcpApiKeys).values({
    id,
    keyHash,
    prefix,
    name,
    companyId,
    createdBy: actor.userId,
    ownerId,
    capabilities: capabilities.join(','),
    expiresAt,
    projectIds,
  });
  return { id, key, prefix };
}

/* ---- shared owner check: members may only touch their own keys ---- */
async function requireKeyOwner(actor: Actor, id: string) {
  const [k] = await db
    .select({ id: mcpApiKeys.id, createdBy: mcpApiKeys.createdBy, companyId: mcpApiKeys.companyId })
    .from(mcpApiKeys)
    .where(eq(mcpApiKeys.id, id))
    .limit(1);
  if (!k) throw new ApiException('NOT_FOUND', 'API Key 不存在');
  if (!actor.isPlatformAdmin && k.createdBy !== actor.userId) {
    throw new ApiException('FORBIDDEN', '只能操作自己创建的令牌', 403);
  }
  return k;
}

/* ---- update a key: 所属人 (first-person identity) and/or 项目白名单 ---- */
export async function updateMcpKey(
  actor: Actor,
  id: string,
  input: { ownerId?: string; projectIds?: string[] | null },
) {
  const k = await requireKeyOwner(actor, id);
  const patch: Partial<{ ownerId: string; projectIds: string[] | null }> = {};
  if (input.ownerId !== undefined) {
    const ownerId = input.ownerId.trim();
    if (!ownerId) throw new ApiException('VALIDATION_FAILED', '所属人不能为空');
    await validateKeyOwner(k.companyId, ownerId);
    patch.ownerId = ownerId;
  }
  // projectIds: undefined = 不动；null = 不限制（全部项目）；数组 = 白名单。
  if (input.projectIds !== undefined) {
    if (input.projectIds) await validateProjectIds(k.companyId, input.projectIds);
    patch.projectIds = input.projectIds;
  }
  if (!Object.keys(patch).length) throw new ApiException('VALIDATION_FAILED', '没有需要修改的字段');
  await db.update(mcpApiKeys).set(patch).where(eq(mcpApiKeys.id, id));
  return { id };
}

/* ---- revoke a key (id stays for audit; revokedAt marks it dead) ---- */
export async function revokeMcpKey(actor: Actor, id: string) {
  await requireKeyOwner(actor, id);
  await db.update(mcpApiKeys).set({ revokedAt: new Date() }).where(eq(mcpApiKeys.id, id));
  return { id };
}

/* ---- hard-delete a key row (unlike revoke, no audit trail is kept) ---- */
export async function deleteMcpKey(actor: Actor, id: string) {
  await requireKeyOwner(actor, id);
  await db.delete(mcpApiKeys).where(eq(mcpApiKeys.id, id));
  return { id };
}
