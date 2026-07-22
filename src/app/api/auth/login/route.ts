import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { ok, fail } from '@/lib/envelope';
import { ensureCurrentMember } from '@/lib/identity';
import { verifyPassword } from '@/lib/password';
import { createSessionCookie } from '@/lib/session';
import { defaultCompanyForUser, jsonBody, route } from '@/server/http';

/* POST /api/auth/login { username, password } → session cookie + the user.
   On success the session also lands on a default company (first membership;
   platform admins without memberships fall back to the first company) — the
   cookie carries it as `cid`. OAuth-only accounts carry '!oauth' as their
   hash — never a valid bcrypt hash, so verifyPassword fails and password
   login stays disabled for them. */
export const POST = route(async (req) => {
  const body = await jsonBody<{ username?: string; password?: string }>(req);
  const username = body.username?.trim();
  const password = body.password;
  if (!username || !password) {
    return fail('VALIDATION_FAILED', '用户名和密码必填');
  }
  const [u] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (!u || !(await verifyPassword(password, u.passwordHash))) {
    return fail('UNAUTHORIZED', '用户名或密码错误', 401);
  }
  const company = await defaultCompanyForUser(u);
  if (company) await ensureCurrentMember(u, company.id); // lazy (user → member) projection on first login
  const c = await createSessionCookie(u, company?.id);
  const res = ok({ id: u.id, username: u.username, name: u.name, role: u.role, companyId: company?.id ?? null });
  res.cookies.set(c.name, c.value, c.options);
  return res;
});
