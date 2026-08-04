import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { ok, fail } from '@/lib/envelope';
import { requireUser } from '@/lib/session';
import { jsonBody, route } from '@/server/http';

/* POST /api/auth/oauth/unbind { provider?: 'lark' | 'github' } — unlink a
   third-party identity from the current account (缺省 'lark'，即飞书/Lark 共用
   的 union_id；'feishu' 视同 'lark'). Refused when it is the account's last
   way in: OAuth-only accounts ('!...' password hash) with no other identity
   left would be locked out. */
export const POST = route(async (req) => {
  const session = await requireUser();
  const body = await jsonBody<{ provider?: string }>(req).catch(() => ({}) as { provider?: string });
  const target: 'larkUnionId' | 'githubId' = body.provider === 'github' ? 'githubId' : 'larkUnionId';

  const [u] = await db.select().from(users).where(eq(users.id, session.uid)).limit(1);
  if (!u) return fail('UNAUTHORIZED', '未登录', 401);

  const otherBound = target === 'githubId' ? !!u.larkUnionId : !!u.githubId;
  if (u.passwordHash.startsWith('!') && !otherBound) {
    return fail('VALIDATION_FAILED', '当前账号仅通过第三方登录，解绑后将无法登录');
  }
  await db.update(users).set({ [target]: null }).where(eq(users.id, u.id));
  return ok({ unbound: true });
});
