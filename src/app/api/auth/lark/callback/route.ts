import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { env } from '@/lib/env';
import { ensureCurrentMember } from '@/lib/identity';
import { createSessionCookie } from '@/lib/session';
import { larkConfigured } from '@/server/lark';

function loginFail(req: NextRequest) {
  return NextResponse.redirect(new URL('/login?error=lark', req.url), 302);
}

/* GET /api/auth/lark/callback?code=...
   code → app_access_token → user_access_token → user_info → find-or-create the
   local user (by larkUnionId) → session cookie → 302 /issues.
   Any failure bounces to /login?error=lark. */
export async function GET(req: NextRequest) {
  if (!larkConfigured()) return loginFail(req);
  const code = req.nextUrl.searchParams.get('code');
  if (!code) return loginFail(req);

  try {
    // 1) app_access_token — the app-level credential.
    const appTokRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: env.larkAppId, app_secret: env.larkAppSecret }),
      signal: AbortSignal.timeout(10_000),
    });
    const appTok = (await appTokRes.json()) as { code?: number; app_access_token?: string };
    if (appTok.code !== 0 || !appTok.app_access_token) {
      throw new Error(`app_access_token failed (code=${appTok.code})`);
    }

    // 2) authorization code → user_access_token.
    const userTokRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${appTok.app_access_token}`,
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code }),
      signal: AbortSignal.timeout(10_000),
    });
    const userTok = (await userTokRes.json()) as { code?: number; data?: { access_token?: string } };
    const userAccessToken = userTok.data?.access_token;
    if (userTok.code !== 0 || !userAccessToken) {
      throw new Error(`oidc access_token failed (code=${userTok.code})`);
    }

    // 3) the user's profile — union_id is the stable cross-app identity.
    const infoRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
      headers: { Authorization: `Bearer ${userAccessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const info = (await infoRes.json()) as { code?: number; data?: { union_id?: string; name?: string } };
    const unionId = info.data?.union_id;
    if (info.code !== 0 || !unionId) throw new Error(`user_info failed (code=${info.code})`);
    const displayName = info.data?.name?.trim() || `飞书用户 ${unionId.slice(0, 8)}`;

    // 4) find-or-create the local user; '!lark' disables password login.
    let [u] = await db.select().from(users).where(eq(users.larkUnionId, unionId)).limit(1);
    if (!u) {
      await db
        .insert(users)
        .values({
          id: crypto.randomUUID(),
          username: `lark_${unionId.slice(0, 8)}`,
          name: displayName,
          passwordHash: '!lark',
          role: 'member',
          larkUnionId: unionId,
        })
        .onConflictDoNothing();
      [u] = await db.select().from(users).where(eq(users.larkUnionId, unionId)).limit(1);
    }
    if (!u) throw new Error('user upsert failed');

    await ensureCurrentMember(u);
    const c = await createSessionCookie(u);
    const res = NextResponse.redirect(new URL('/issues', req.url), 302);
    res.cookies.set(c.name, c.value, c.options);
    return res;
  } catch (e) {
    console.error('[auth/lark] callback failed:', e);
    return loginFail(req);
  }
}
