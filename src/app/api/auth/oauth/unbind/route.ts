import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { ok, fail } from '@/lib/envelope';
import { requireUser } from '@/lib/session';
import { route } from '@/server/http';

/* POST /api/auth/oauth/unbind — unlink the Feishu/Lark identity from the
   current account. Refused for OAuth-only accounts ('!...' password hash):
   they have no password to fall back on, so unbinding would lock them out. */
export const POST = route(async () => {
  const session = await requireUser();
  const [u] = await db.select().from(users).where(eq(users.id, session.uid)).limit(1);
  if (!u) return fail('UNAUTHORIZED', '未登录', 401);
  if (u.passwordHash.startsWith('!')) {
    return fail('VALIDATION_FAILED', '当前账号仅通过第三方登录，解绑后将无法登录');
  }
  await db.update(users).set({ larkUnionId: null }).where(eq(users.id, u.id));
  return ok({ unbound: true });
});
