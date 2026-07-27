import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { ok, fail } from '@/lib/envelope';
import { hashPassword, verifyPassword } from '@/lib/password';
import { requireUser } from '@/lib/session';
import { jsonBody, route } from '@/server/http';

/* POST /api/auth/change-password { oldPassword?, newPassword } → 修改密码。
   已有密码的账号必须验旧密码;纯 OAuth 账号(passwordHash === '!oauth',
   不是合法 bcrypt hash)没有旧密码可验 —— 免验直接设置,设置后密码登录
   自然开通(密码登录与 Lark/飞书登录由此统一到同一账号)。 */
export const POST = route(async (req) => {
  const session = await requireUser();
  const body = await jsonBody<{ oldPassword?: string; newPassword?: string }>(req);
  const oldPassword = body.oldPassword;
  const newPassword = body.newPassword;
  if (!newPassword) {
    return fail('VALIDATION_FAILED', '新密码必填');
  }
  if (newPassword.length < 6) {
    return fail('VALIDATION_FAILED', '新密码至少 6 位');
  }
  const [u] = await db.select().from(users).where(eq(users.id, session.uid)).limit(1);
  if (!u) return fail('UNAUTHORIZED', '未登录', 401);
  const oauthOnly = u.passwordHash === '!oauth';
  if (!oauthOnly) {
    if (!oldPassword) return fail('VALIDATION_FAILED', '旧密码必填');
    if (!(await verifyPassword(oldPassword, u.passwordHash))) {
      return fail('FORBIDDEN', '旧密码不正确', 403);
    }
  }
  await db.update(users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(users.id, u.id));
  return ok({ changed: true });
});
