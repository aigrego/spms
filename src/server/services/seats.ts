import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { companyMemberships, users } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { revokeMemberProjection } from '@/lib/identity';
import { CONFIGURABLE_ROLES } from '@/lib/permissions';

/* 席位(company_memberships)共享实现:平台管理台(services/platform.ts)与
   研发资源页(services/resources.ts)原本各抄一份逐行相同的外壳,仅权限门
   不同(TKT-243 收敛)。这里只做数据操作与通用校验;两个入口各自做权限门
   校验后委托本模块,对外 shape 各自保留(platform 侧返回 id,resources 侧
   返回 membershipId)。 */

// The 5 built-in company roles: company_admin + the 4 configurable ones.
export const COMPANY_ROLES = ['company_admin', ...CONFIGURABLE_ROLES] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export function assertCompanyRole(role: string): asserts role is CompanyRole {
  if (!(COMPANY_ROLES as readonly string[]).includes(role)) {
    throw new ApiException('VALIDATION_FAILED', `role 必须是内置角色之一（${COMPANY_ROLES.join(' / ')}）`);
  }
}

/* ---- 最后一个 company_admin 保护(BUG-11):目标席位是该公司唯一的
   company_admin 时拒绝移除/降级,防止公司失去所有管理员。 ---- */
export async function assertNotLastCompanyAdmin(
  companyId: string,
  membershipId: string,
  action: string,
): Promise<void> {
  const admins = await db
    .select({ id: companyMemberships.id })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.role, 'company_admin')));
  if (admins.length === 1 && admins[0].id === membershipId) {
    throw new ApiException('VALIDATION_FAILED', `不能${action}该公司唯一的公司管理员`);
  }
}

/* ---- a company's memberships joined with the users row ---- */
export async function querySeats(companyId: string) {
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
    .where(eq(companyMemberships.companyId, companyId))
    .orderBy(asc(companyMemberships.createdAt));
}

async function seatInCompany(companyId: string, membershipId: string) {
  const [m] = await db
    .select({ id: companyMemberships.id, userId: companyMemberships.userId })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.id, membershipId), eq(companyMemberships.companyId, companyId)))
    .limit(1);
  if (!m) throw new ApiException('MEMBER_NOT_FOUND', '成员不存在');
  return m;
}

/* ---- change a seat's company role ---- */
export async function setSeatRole(companyId: string, membershipId: string, role: CompanyRole) {
  assertCompanyRole(role);
  await seatInCompany(companyId, membershipId);
  // BUG-11:不能把公司唯一的 company_admin 降为其他角色
  if (role !== 'company_admin') await assertNotLastCompanyAdmin(companyId, membershipId, '降级');
  await db.update(companyMemberships).set({ role }).where(eq(companyMemberships.id, membershipId));
  return { id: membershipId, role };
}

/* ---- remove a seat (the user account survives; their pool projection is
   revoked too so they leave assignee candidate lists) ---- */
export async function deleteSeat(companyId: string, membershipId: string) {
  const seat = await seatInCompany(companyId, membershipId);
  // BUG-11:不能移除公司唯一的 company_admin
  await assertNotLastCompanyAdmin(companyId, membershipId, '移除');
  // 删席位与 revoke 投影同生同灭 → 一个事务:revokeMemberProjection 传入 tx
  // (内部 unassign/status 写走同一句柄),不再出现"席位已删但投影仍 active"
  // (或反之)的半截状态。
  await db.transaction(async (tx) => {
    await tx.delete(companyMemberships).where(eq(companyMemberships.id, membershipId));
    await revokeMemberProjection(companyId, seat.userId, tx);
  });
  return { id: membershipId };
}
