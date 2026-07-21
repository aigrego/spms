import { and, asc, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { companies, companyMemberships, users } from '@/db/schema';
import { ApiException, fail, ok } from '@/lib/envelope';
import { ensureCurrentMember } from '@/lib/identity';
import { createSessionCookie, requireUser } from '@/lib/session';
import type { Actor } from './services/types';

/* HTTP plumbing shared by every API route (Phase B2):
   - route()        wraps a handler: ApiException → fail(code,msg,status);
                    unknown errors log + 500 INTERNAL.
   - requireActor() session gate (401) + users row + current-company resolution
                    (session cid → validated membership, with fallbacks) + lazy
                    member projection → the Actor every service expects.
   - jsonBody()     parses the request JSON; malformed → VALIDATION_FAILED.
   - requireAdmin() platform-admin gate (actor.role === 'admin'). */

export function route<Ctx>(
  fn: (req: NextRequest, ctx: Ctx) => Promise<NextResponse>,
): (req: NextRequest, ctx: Ctx) => Promise<NextResponse> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiException) return fail(e.code, e.message, e.status);
      console.error('[api] unexpected error:', e);
      return fail('INTERNAL', '服务内部错误', 500);
    }
  };
}

export interface CompanyRef {
  id: string;
  key: string;
  name: string;
  color: string | null;
}

const companyColumns = { id: companies.id, key: companies.key, name: companies.name, color: companies.color };

/* The user's membership role inside a company (null when not a member). */
export async function membershipRoleOf(userId: string, companyId: string): Promise<string | null> {
  const [m] = await db
    .select({ role: companyMemberships.role })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.userId, userId), eq(companyMemberships.companyId, companyId)))
    .limit(1);
  return m?.role ?? null;
}

/* Companies the user can enter: their membership companies, oldest first.
   Platform admins see every company. */
export async function listCompaniesForUser(user: { id: string; role: string }): Promise<CompanyRef[]> {
  if (user.role === 'admin') {
    return db.select(companyColumns).from(companies).orderBy(asc(companies.createdAt));
  }
  return db
    .select(companyColumns)
    .from(companyMemberships)
    .innerJoin(companies, eq(companyMemberships.companyId, companies.id))
    .where(eq(companyMemberships.userId, user.id))
    .orderBy(asc(companyMemberships.createdAt));
}

/* The company a session lands on when no (valid) cid is present: the user's
   first membership; a platform admin without memberships falls back to the
   first company. Null when nothing qualifies (→ NO_COMPANY). */
export async function defaultCompanyForUser(user: { id: string; role: string }): Promise<CompanyRef | null> {
  const [m] = await db
    .select(companyColumns)
    .from(companyMemberships)
    .innerJoin(companies, eq(companyMemberships.companyId, companies.id))
    .where(eq(companyMemberships.userId, user.id))
    .orderBy(asc(companyMemberships.createdAt))
    .limit(1);
  if (m) return m;
  if (user.role === 'admin') {
    const [c] = await db.select(companyColumns).from(companies).orderBy(asc(companies.createdAt)).limit(1);
    return c ?? null;
  }
  return null;
}

/* Resolve the current company for a session. A present cid wins when the user
   is a member of it, or when a platform admin targets an existing company; a
   missing/invalid cid falls back to defaultCompanyForUser(). Returns the
   company + the membership role (null for a non-member platform admin). */
async function resolveSessionCompany(
  user: { id: string; role: string },
  cid: string | undefined,
): Promise<{ company: CompanyRef; memberRole: string | null } | null> {
  if (cid) {
    const [c] = await db.select(companyColumns).from(companies).where(eq(companies.id, cid)).limit(1);
    if (c) {
      const memberRole = await membershipRoleOf(user.id, cid);
      if (memberRole) return { company: c, memberRole };
      if (user.role === 'admin') return { company: c, memberRole: null };
    }
    // missing/invalid cid (or no access) → fall through to the default
  }
  const fallback = await defaultCompanyForUser(user);
  if (!fallback) return null;
  const memberRole = await membershipRoleOf(user.id, fallback.id);
  return { company: fallback, memberRole };
}

export async function requireActor(): Promise<Actor> {
  const session = await requireUser(); // throws UNAUTHORIZED 401 when logged out
  const [u] = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.id, session.uid))
    .limit(1);
  if (!u) throw new ApiException('UNAUTHORIZED', '未登录', 401);

  const resolved = await resolveSessionCompany(u, session.cid);
  if (!resolved) throw new ApiException('NO_COMPANY', '需要被加入一个公司后才能访问', 403);
  const isPlatformAdmin = u.role === 'admin';
  // A platform admin without a membership acts as company_admin; a member
  // keeps their company_memberships.role.
  const companyRole = resolved.memberRole ?? 'company_admin';
  const member = await ensureCurrentMember(u, resolved.company.id);
  return {
    userId: u.id,
    memberId: member.id,
    name: u.name,
    role: u.role,
    companyId: resolved.company.id,
    companyRole,
    isPlatformAdmin,
  };
}

export async function jsonBody<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiException('VALIDATION_FAILED', '请求体不是合法 JSON');
  }
}

/* Platform-level admin gate (platform routes only — company-level gating goes
   through requirePerm in @/lib/permissions). */
export function requireAdmin(actor: Actor): void {
  if (actor.role !== 'admin') throw new ApiException('FORBIDDEN', '需要管理员权限', 403);
}

export const requirePlatformAdmin = requireAdmin;

/* Enter a company: re-sign the session cookie with `cid` pointing at the
   target company and return ok({ companyId }) with the cookie set. Requires
   membership in the target company, or platform admin (target company must
   exist). Shared by /api/auth/switch-company and /api/v1/platform/companies/:id/enter. */
export async function enterCompanyResponse(userId: string, companyId: string): Promise<NextResponse> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new ApiException('UNAUTHORIZED', '未登录', 401);

  const memberRole = await membershipRoleOf(u.id, companyId);
  if (!memberRole) {
    if (u.role !== 'admin') throw new ApiException('FORBIDDEN', '不是该公司成员', 403);
    const [c] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!c) throw new ApiException('NOT_FOUND', '公司不存在');
  }

  const c = await createSessionCookie(u, companyId);
  const res = ok({ companyId });
  res.cookies.set(c.name, c.value, c.options);
  return res;
}
