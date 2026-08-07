import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { companyMemberships, members, users } from '@/db/schema';
import { findUserByEmail, primaryEmailsFor } from '@/lib/emails';
import { ApiException } from '@/lib/envelope';
import { initialsFor, colorFor, revokeMemberProjection } from '@/lib/identity';
import { unassignMemberEverywhere } from '@/lib/assignments';
import { requirePerm } from '@/lib/permissions';
import { COMPANY_ROLES, assertNotLastCompanyAdmin, type CompanyRole } from './platform';
import type { Actor } from './types';

/* PMS-2 §5.1 — 研发资源池 (resource pool) business service. Ported from
   apps/spms-server/src/routes/resources.ts. The pool = the company's `members`
   rows: internal humans (local users), invited external resources, and AI
   agents. External resources are nameable/assignable/displayable now; their
   real login is deferred. The portal sync-directory endpoint has no rewrite
   equivalent (no portal directory).

   Multi-company: the pool is per company — members.(companyId, userId) /
   (companyId, email) are the de-dup keys. Module gate: `resources` read/write. */

type MemberRow = typeof members.$inferSelect;

export function serializeMember(m: MemberRow) {
  return {
    id: m.id,
    type: m.type,
    name: m.name,
    initials: m.initials,
    color: m.color,
    role: m.role,
    userId: m.userId,
    agentKey: m.agentKey,
    origin: m.origin,
    email: m.email,
    status: m.status,
    avatarUrl: m.avatarUrl,
  };
}

/* ---- list the resource pool (internal / external / agent, with status) ----
   内部成员的展示邮箱取 user_emails 主邮箱(members.email 只存外部邀请邮箱)。 */
export async function listMembers(actor: Actor) {
  await requirePerm(actor, 'resources', 'read');
  const rows = await db
    .select()
    .from(members)
    .where(eq(members.companyId, actor.companyId))
    .orderBy(asc(members.type), asc(members.name));
  const emailMap = await primaryEmailsFor(rows.map((r) => r.userId).filter((v): v is string => !!v));
  return rows.map((m) => {
    const email = m.email || (m.userId ? emailMap.get(m.userId) : null) || null;
    return serializeMember({ ...m, email });
  });
}

export interface InviteInput {
  name?: string;
  email?: string;
  userId?: string; // a local users.id not yet projected into the pool
}

/* ---- invite an external resource (email, or a local user from outside the pool) ----
   At least one of email / userId is required; the pool is de-duped on both.
   邮箱已属于某个平台用户(user_emails 主/备)→ 直接落 userId、转
   internal/active 并授 viewer 席位,与 Lark 认领(claimExternalInvites)的
   结果一致;否则维持"外部邀请预埋"流程,等本人 Lark 登录认领。 */
export async function invite(actor: Actor, input: InviteInput) {
  await requirePerm(actor, 'resources', 'write');
  const email = input.email?.trim() || null;
  let userId = input.userId?.trim() || null;
  if (!email && !userId) throw new ApiException('VALIDATION_FAILED', '请提供邮箱或用户 ID');

  // De-dup against the company pool (members.(companyId,email) / (companyId,userId)).
  if (email) {
    const [dupe] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.companyId, actor.companyId), eq(members.email, email)))
      .limit(1);
    if (dupe) throw new ApiException('INVITE_FAILED', '该邮箱已在资源池中');
  }
  // 邮箱 → 平台用户:外部邀请与内部成员在此统一。
  let claimedUser = false;
  if (!userId && email) {
    userId = await findUserByEmail(email);
    claimedUser = !!userId;
  }
  let invitedUserName: string | null = null;
  if (userId) {
    const [dupe] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.companyId, actor.companyId), eq(members.userId, userId)))
      .limit(1);
    if (dupe) throw new ApiException('INVITE_FAILED', '该用户已在资源池中');
    // Default the display name from the local users row when one exists.
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    invitedUserName = u?.name ?? null;
  }

  const name = (input.name?.trim() || invitedUserName || email?.split('@')[0] || userId || '外部资源').trim();
  const id = crypto.randomUUID();
  // 资源池行 + (认领用户时的)viewer 席位同生同灭 → 一个事务。
  await db.transaction(async (tx) => {
    await tx.insert(members).values({
      id,
      companyId: actor.companyId,
      type: 'human',
      name,
      initials: initialsFor(name),
      color: colorFor(email ?? userId ?? name),
      role: null,
      userId,
      agentKey: null,
      origin: claimedUser ? 'internal' : 'external',
      email,
      status: claimedUser ? 'active' : 'invited',
    });
    if (claimedUser && userId) {
      await tx
        .insert(companyMemberships)
        .values({ id: crypto.randomUUID(), userId, companyId: actor.companyId, role: 'viewer' })
        .onConflictDoNothing();
    }
  });

  const [row] = await db.select().from(members).where(eq(members.id, id)).limit(1);
  return serializeMember(row!);
}

/* ---- revoke an external resource: status=revoked + unassign from all nodes ---- */
export async function revoke(actor: Actor, id: string) {
  await requirePerm(actor, 'resources', 'write');
  const [m] = await db
    .select()
    .from(members)
    .where(and(eq(members.companyId, actor.companyId), eq(members.id, id)))
    .limit(1);
  if (!m) throw new ApiException('RESOURCE_NOT_FOUND');
  if (m.origin !== 'external') throw new ApiException('VALIDATION_FAILED', '只能撤销外部资源');
  await unassignMemberEverywhere(actor.companyId, m.id);
  await db.update(members).set({ status: 'revoked' }).where(eq(members.id, m.id));
  return { id: m.id, status: 'revoked' as const };
}

/* ============================ Seats (公司席位) ============================
   席位 = company_memberships:哪些系统用户能进入本公司、以什么公司角色。
   在研发资源页展示与配置;写操作仅 company_admin / 平台管理员。 */

function requireSeatAdmin(actor: Actor): void {
  if (actor.isPlatformAdmin || actor.companyRole === 'company_admin') return;
  throw new ApiException('FORBIDDEN', '需要公司管理员权限', 403);
}

/* ---- list the current company's seats (memberships ⋈ users) ---- */
export async function listSeats(actor: Actor) {
  await requirePerm(actor, 'resources', 'read');
  return db
    .select({
      membershipId: companyMemberships.id,
      userId: users.id,
      username: users.username,
      name: users.name,
      role: companyMemberships.role,
      createdAt: companyMemberships.createdAt,
    })
    .from(companyMemberships)
    .innerJoin(users, eq(companyMemberships.userId, users.id))
    .where(eq(companyMemberships.companyId, actor.companyId))
    .orderBy(asc(companyMemberships.createdAt));
}

async function seatInCompany(actor: Actor, membershipId: string) {
  const [m] = await db
    .select({ id: companyMemberships.id, userId: companyMemberships.userId })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.id, membershipId), eq(companyMemberships.companyId, actor.companyId)))
    .limit(1);
  if (!m) throw new ApiException('MEMBER_NOT_FOUND', '成员不存在');
  return m;
}

/* ---- change a seat's company role (管理员/产品/开发/测试/访客) ---- */
export async function updateSeatRole(actor: Actor, membershipId: string, role: CompanyRole) {
  requireSeatAdmin(actor);
  if (!(COMPANY_ROLES as readonly string[]).includes(role)) {
    throw new ApiException('VALIDATION_FAILED', `role 必须是内置角色之一（${COMPANY_ROLES.join(' / ')}）`);
  }
  await seatInCompany(actor, membershipId);
  // BUG-11:不能把公司唯一的 company_admin 降为其他角色
  if (role !== 'company_admin') await assertNotLastCompanyAdmin(actor.companyId, membershipId, '降级');
  await db.update(companyMemberships).set({ role }).where(eq(companyMemberships.id, membershipId));
  return { id: membershipId, role };
}

/* ---- revoke a seat (the user account survives; their pool projection is
   revoked too so they leave assignee candidate lists) ---- */
export async function removeSeat(actor: Actor, membershipId: string) {
  requireSeatAdmin(actor);
  const seat = await seatInCompany(actor, membershipId);
  // BUG-11:不能移除公司唯一的 company_admin
  await assertNotLastCompanyAdmin(actor.companyId, membershipId, '移除');
  await db.delete(companyMemberships).where(eq(companyMemberships.id, membershipId));
  await revokeMemberProjection(actor.companyId, seat.userId);
  return { id: membershipId };
}
