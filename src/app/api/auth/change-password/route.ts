import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { ok, fail } from '@/lib/envelope';
import { hashPassword, verifyPassword } from '@/lib/password';
import { requireUser } from '@/lib/session';
import { jsonBody, route } from '@/server/http';

/* POST /api/auth/change-password { oldPassword, newPassword } → verifies the
   old password, then replaces the hash. Lark-only accounts carry '!lark' as
   their hash — never a valid bcrypt hash — so the old-password check fails
   and they cannot set a password here. */
export const POST = route(async (req) => {
  const session = await requireUser();
  const body = await jsonBody<{ oldPassword?: string; newPassword?: string }>(req);
  const oldPassword = body.oldPassword;
  const newPassword = body.newPassword;
  if (!oldPassword || !newPassword) {
    return fail('VALIDATION_FAILED', '旧密码和新密码必填');
  }
  if (newPassword.length < 6) {
    return fail('VALIDATION_FAILED', '新密码至少 6 位');
  }
  const [u] = await db.select().from(users).where(eq(users.id, session.uid)).limit(1);
  if (!u) return fail('UNAUTHORIZED', '未登录', 401);
  if (!(await verifyPassword(oldPassword, u.passwordHash))) {
    return fail('FORBIDDEN', '旧密码不正确', 403);
  }
  await db.update(users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(users.id, u.id));
  return ok({ changed: true });
});
