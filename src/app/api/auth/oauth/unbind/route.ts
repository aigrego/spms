import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { ok, fail } from '@/lib/envelope';
import { requireUser } from '@/lib/session';
import { route } from '@/server/http';
import { jsonBodyWith, oauthUnbindSchema } from '@/server/validate';

/* POST /api/auth/oauth/unbind { provider?: 'feishu' | 'lark' | 'github' } — unlink
   a third-party identity from the current account (缺省 'feishu'；飞书与 Lark
   分列存储，解绑互不影响). Refused when it is the account's last
   way in: OAuth-only accounts ('!...' password hash) with no other identity
   left would be locked out. */
export const POST = route(async (req) => {
  const session = await requireUser();
  // provider 可省略(前端始终发 JSON 体);非法 JSON / 非法 provider 不再静默吞掉。
  const body = await jsonBodyWith(req, oauthUnbindSchema);
  const provider = body.provider ?? 'feishu';
  const target: 'feishuUnionId' | 'larkUnionId' | 'githubId' =
    provider === 'github' ? 'githubId' : provider === 'lark' ? 'larkUnionId' : 'feishuUnionId';

  const [u] = await db.select().from(users).where(eq(users.id, session.uid)).limit(1);
  if (!u) return fail('UNAUTHORIZED', '未登录', 401);

  const otherBound =
    (target !== 'feishuUnionId' && !!u.feishuUnionId) ||
    (target !== 'larkUnionId' && !!u.larkUnionId) ||
    (target !== 'githubId' && !!u.githubId);
  if (u.passwordHash.startsWith('!') && !otherBound) {
    return fail('VALIDATION_FAILED', '当前账号仅通过第三方登录，解绑后将无法登录');
  }
  await db.update(users).set({ [target]: null }).where(eq(users.id, u.id));
  return ok({ unbound: true });
});
