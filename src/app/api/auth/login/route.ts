import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { ok, fail } from '@/lib/envelope';
import { findUserByEmail } from '@/lib/emails';
import { ensureCurrentMember } from '@/lib/identity';
import { verifyPassword } from '@/lib/password';
import { rateLimited, rateLimitRecord, rateLimitReset } from '@/lib/rateLimit';
import { createSessionCookie } from '@/lib/session';
import { defaultCompanyForUser, jsonBody, route } from '@/server/http';

/* 登录失败限流:同一 IP+用户名 1 分钟内最多 5 次失败,超限返回 429。 */
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_FAILURES = 5;

/* 用户不存在时也对它做一次 bcrypt 比较,抹平「用户存在与否」的响应时间差
   (防用户名枚举)。值是随机字符串的 bcrypt hash,任何密码都不会匹配它。 */
const DUMMY_HASH = '$2b$10$1oNRU9VSxEUp5yu/jrMCHeaC7y3S0Yn1v/dn17XFRTzSTHB/kYalC';

/* POST /api/auth/login { username, password } → session cookie + the user.
   `username` 也接受任一邮箱（主/备，大小写不敏感）——邮箱经 user_emails
   反查用户，与用户名登录共用同一密码。
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
  // 来源 IP:反代链路取 x-forwarded-for 首跳,其次 x-real-ip,取不到 'unknown'。
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const rateKey = `${ip}:${username.toLowerCase()}`;
  if (rateLimited(rateKey, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS)) {
    return fail('RATE_LIMITED', undefined, 429);
  }
  let [u] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (!u && username.includes('@')) {
    const uid = await findUserByEmail(username);
    if (uid) [u] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
  }
  const passwordOk = await verifyPassword(password, u?.passwordHash ?? DUMMY_HASH);
  if (!u || !passwordOk) {
    rateLimitRecord(rateKey, LOGIN_WINDOW_MS);
    return fail('UNAUTHORIZED', '用户名或密码错误', 401);
  }
  rateLimitReset(rateKey);
  const company = await defaultCompanyForUser(u);
  if (company) await ensureCurrentMember(u, company.id); // lazy (user → member) projection on first login
  const c = await createSessionCookie(u, company?.id);
  const res = ok({ id: u.id, username: u.username, name: u.name, role: u.role, companyId: company?.id ?? null });
  res.cookies.set(c.name, c.value, c.options);
  return res;
});
