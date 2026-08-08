import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { primaryEmailOf } from '@/lib/emails';
import { ok } from '@/lib/envelope';
import { permsForActor } from '@/lib/permissions';
import { getSession } from '@/lib/session';
import { listCompaniesForUser, membershipRoleOf, route } from '@/server/http';

/* GET /api/auth/session → the session view when logged in, null otherwise:
     { user, companies, currentCompany, companyRole, isPlatformAdmin, permissions }
   - companies:      companies the user can enter (member companies; platform
                     admins see all)
   - currentCompany: the session cid when still valid, else the first visible
                     company (null when the user belongs nowhere)
   - companyRole:    company_memberships.role in currentCompany; a platform
                     admin without membership counts as 'company_admin'
   - permissions:    effective per-module levels for the frontend to filter UI
   (name/role live on the users row, not the JWT, so join it back.) */
export const GET = route(async () => {
  const session = await getSession();
  if (!session) return ok(null);
  const [u] = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      role: users.role,
      feishuUnionId: users.feishuUnionId,
      larkUnionId: users.larkUnionId,
      githubId: users.githubId,
      avatarUrl: users.avatarUrl,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.id, session.uid))
    .limit(1);
  if (!u) return ok(null);
  const user = {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    feishuBound: !!u.feishuUnionId,
    larkBound: !!u.larkUnionId,
    githubBound: !!u.githubId,
    avatarUrl: u.avatarUrl,
    email: await primaryEmailOf(u.id),
    hasPassword: u.passwordHash !== '!oauth',
  };

  const isPlatformAdmin = u.role === 'admin';
  const companyList = await listCompaniesForUser(u);
  const currentCompany =
    (session.cid ? companyList.find((c) => c.id === session.cid) : null) ?? companyList[0] ?? null;
  let companyRole: string | null = null;
  if (currentCompany) {
    companyRole =
      (await membershipRoleOf(u.id, currentCompany.id)) ?? (isPlatformAdmin ? 'company_admin' : null);
  }
  const permissions = await permsForActor({ companyRole, isPlatformAdmin, companyId: currentCompany?.id });

  return ok({ user, companies: companyList, currentCompany, companyRole, isPlatformAdmin, permissions });
});
