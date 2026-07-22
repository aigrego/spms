import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { claimExternalInvites, ensureCurrentMember, syncMemberProjection } from '@/lib/identity';
import { createSessionCookie, getSession } from '@/lib/session';
import { defaultCompanyForUser } from '@/server/http';
import { BIND_STATE_COOKIE, fetchOAuthProfile, parseProvider, providerConfigured } from '@/server/lark';

function loginFail(req: NextRequest, provider: string) {
  return NextResponse.redirect(new URL(`/login?error=${provider}`, req.url), 302);
}

function bindResult(req: NextRequest, result: 'bound' | 'taken' | 'failed') {
  const url = new URL('/profile', req.url);
  url.searchParams.set('tab', 'security');
  url.searchParams.set('oauth', result);
  const res = NextResponse.redirect(url, 302);
  res.cookies.delete(BIND_STATE_COOKIE);
  return res;
}

/* username 优先取邮箱（可读、唯一），被占用则退化为 <provider>_<unionId前8>，
   再冲突（理论不会发生）追加随机后缀。 */
async function pickUsername(preferred: string | undefined, fallback: string): Promise<string> {
  for (const c of [preferred, fallback]) {
    if (!c) continue;
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.username, c)).limit(1);
    if (!taken) return c;
  }
  return `${fallback}_${crypto.randomUUID().slice(0, 4)}`;
}

/* GET /api/auth/<feishu|lark>/callback?code=...&state=...
   Two modes, selected by `state`:
   - state=bind.<nonce> (from /api/auth/<p>/bind): verify the nonce cookie and
     the active session, then link union_id onto THAT user (no new account,
     no re-login) → 302 /profile?tab=security&oauth=bound|taken|failed.
   - otherwise (login mode):
     1) union_id 命中 users.larkUnionId → 老用户直接登录;
     2) 否则创建 users 账号（'!oauth' 禁用密码登录），并用 OAuth 邮箱认领
        「邀请外部资源」预埋的 members 行 —— 回填 userId、转 internal/active，
        为每个邀请公司自动分配 viewer 席位（见 identity.claimExternalInvites）;
        邮箱无匹配则只是平台成员（无公司席位，等平台管理员分配）。
     → session cookie → 302 /issues。任何失败跳 /login?error=<provider>。 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
) {
  const raw = (await ctx.params).provider;
  const p = parseProvider(raw);
  if (!p || !providerConfigured(p)) return loginFail(req, raw);
  const code = req.nextUrl.searchParams.get('code');
  if (!code) return loginFail(req, p);

  const state = req.nextUrl.searchParams.get('state') ?? '';
  const bindNonce = state.startsWith('bind.') ? state.slice('bind.'.length) : null;

  if (bindNonce) {
    // Bind mode: nonce must match the cookie set by /bind, and the initiator
    // must still be logged in — the identity links to their account.
    const cookieNonce = req.cookies.get(BIND_STATE_COOKIE)?.value;
    const session = await getSession();
    if (!cookieNonce || cookieNonce !== bindNonce || !session) return bindResult(req, 'failed');
    try {
      const profile = await fetchOAuthProfile(p, code);
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.larkUnionId, profile.unionId))
        .limit(1);
      if (taken && taken.id !== session.uid) return bindResult(req, 'taken');
      await db.update(users).set({ larkUnionId: profile.unionId }).where(eq(users.id, session.uid));
      // 绑定的身份同样按邮箱认领外部邀请（邀请 = 公司希望此人加入的意图）。
      if (profile.email) await claimExternalInvites({ id: session.uid }, profile.email);
      return bindResult(req, 'bound');
    } catch (e) {
      console.error(`[auth/${p}] bind callback failed:`, e);
      return bindResult(req, 'failed');
    }
  }

  try {
    const profile = await fetchOAuthProfile(p, code);

    let [u] = await db.select().from(users).where(eq(users.larkUnionId, profile.unionId)).limit(1);
    if (!u) {
      const displayName =
        profile.name || `${p === 'feishu' ? '飞书' : 'Lark'}用户 ${profile.unionId.slice(0, 8)}`;
      const username = await pickUsername(profile.email, `${p}_${profile.unionId.slice(0, 8)}`);
      await db
        .insert(users)
        .values({
          id: crypto.randomUUID(),
          username,
          name: displayName,
          passwordHash: '!oauth',
          role: 'member',
          larkUnionId: profile.unionId,
          avatarUrl: profile.avatarUrl ?? null,
        })
        .onConflictDoNothing();
      [u] = await db.select().from(users).where(eq(users.larkUnionId, profile.unionId)).limit(1);
      if (!u) throw new Error('user upsert failed');
      if (profile.email) {
        const claimed = await claimExternalInvites(u, profile.email);
        if (claimed > 0) {
          console.info(`[auth/${p}] ${u.username} claimed ${claimed} external invite(s)`);
        }
      }
      // 把 OAuth 昵称/头像同步到认领的（以及所有）member 投影行。
      await syncMemberProjection(u);
    } else {
      // 老用户登录：昵称/头像有变化则刷新 users 并同步 member 投影。
      const name = profile.name || u.name;
      const avatarUrl = profile.avatarUrl ?? null;
      if (u.name !== name || u.avatarUrl !== avatarUrl) {
        await db.update(users).set({ name, avatarUrl }).where(eq(users.id, u.id));
        await syncMemberProjection({ id: u.id, name, avatarUrl });
        u.name = name;
        u.avatarUrl = avatarUrl;
      }
    }

    const company = await defaultCompanyForUser(u);
    if (company) await ensureCurrentMember(u, company.id);
    const c = await createSessionCookie(u, company?.id);
    const res = NextResponse.redirect(new URL('/issues', req.url), 302);
    res.cookies.set(c.name, c.value, c.options);
    return res;
  } catch (e) {
    console.error(`[auth/${p}] callback failed:`, e);
    return loginFail(req, p);
  }
}
