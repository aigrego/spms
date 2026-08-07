import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { findUserByEmail, upsertVerifiedEmail } from '@/lib/emails';
import { claimExternalInvites, ensureCurrentMember, syncMemberProjection } from '@/lib/identity';
import { createSessionCookie, getSession } from '@/lib/session';
import { defaultCompanyForUser } from '@/server/http';
import { BIND_STATE_COOKIE, LOGIN_STATE_COOKIE, fetchOAuthProfile, parseProvider, providerConfigured, type OAuthProvider } from '@/server/lark';

/* 各 provider 的稳定身份存哪个字段：飞书/Lark 共享 union_id，GitHub 用数字 id。 */
function identityKey(p: OAuthProvider): 'larkUnionId' | 'githubId' {
  return p === 'github' ? 'githubId' : 'larkUnionId';
}

function providerLabel(p: OAuthProvider): string {
  return p === 'feishu' ? '飞书' : p === 'lark' ? 'Lark' : 'GitHub';
}

function loginFail(req: NextRequest, provider: string, reason?: string) {
  const url = new URL(`/login?error=${provider}`, req.url);
  // 失败环节带上 reason(state/code/exchange),生产排障只看 URL 就能区分
  // state 校验失败 / 缺少 code / 换取 token 或落库失败。
  if (reason) url.searchParams.set('reason', reason);
  const res = NextResponse.redirect(url, 302);
  res.cookies.delete(LOGIN_STATE_COOKIE);
  return res;
}

function bindResult(req: NextRequest, result: 'bound' | 'taken' | 'failed') {
  const url = new URL('/profile/security', req.url);
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

/* GET /api/auth/<feishu|lark|github>/callback?code=...&state=...
   Two modes, selected by `state`:
   - state=bind.<nonce> (from /api/auth/<p>/bind): verify the nonce cookie and
     the active session, then link the provider identity onto THAT user (no new
     account, no re-login) → 302 /profile/security?oauth=bound|taken|failed.
   - state=login.<nonce> (from /api/auth/<p>/login): verify the nonce cookie
     (login CSRF guard), then:
     1) 身份命中 users.larkUnionId / githubId → 老用户直接登录;
     2) 身份未命中但 IdP 邮箱匹配任一已有邮箱（user_emails 主/备，其次用户名）
        → 把身份绑到该账号（IdP 已证明邮箱归属），邮箱升级 verified 并认领邀请;
     3) 都无匹配则创建 users 账号（'!oauth' 禁用密码登录，可在 /profile 安全页
        补设密码开通密码登录），IdP 邮箱登记进 user_emails（verified），并用该
        邮箱认领「邀请外部资源」预埋的 members 行 —— 回填 userId、转
        internal/active，为每个邀请公司自动分配 viewer 席位（见
        identity.claimExternalInvites）;
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
  if (!code) return loginFail(req, p, 'code');

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
      const idKey = identityKey(p);
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users[idKey], profile.unionId))
        .limit(1);
      if (taken && taken.id !== session.uid) return bindResult(req, 'taken');
      await db.update(users).set({ [idKey]: profile.unionId }).where(eq(users.id, session.uid));
      // IdP 邮箱登记为 verified 邮箱;绑定的身份同样按邮箱认领外部邀请
      //(邀请 = 公司希望此人加入的意图)。
      if (profile.email) {
        await upsertVerifiedEmail(session.uid, profile.email);
        await claimExternalInvites({ id: session.uid }, profile.email);
      }
      return bindResult(req, 'bound');
    } catch (e) {
      console.error(`[auth/${p}] bind callback failed:`, e);
      return bindResult(req, 'failed');
    }
  }

  // Login mode: state must be login.<nonce> and match the cookie set by
  // /login — proves this browser initiated the flow (login CSRF guard).
  const loginNonce = state.startsWith('login.') ? state.slice('login.'.length) : null;
  const loginCookie = req.cookies.get(LOGIN_STATE_COOKIE)?.value;
  if (!loginNonce || !loginCookie || loginCookie !== loginNonce) return loginFail(req, p, 'state');

  try {
    const profile = await fetchOAuthProfile(p, code);
    const idKey = identityKey(p);

    let [u] = await db.select().from(users).where(eq(users[idKey], profile.unionId)).limit(1);
    let matchedByEmail = false;
    if (!u && profile.email) {
      // 邮箱匹配：IdP 已证明该邮箱归本人所有，命中任一已有账号（user_emails
      // 主/备优先，其次用户名恰为该邮箱）就把身份绑到该账号，而不是新建重复账号。
      const email = profile.email.trim().toLowerCase();
      const uid = await findUserByEmail(email);
      if (uid) [u] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
      if (!u) [u] = await db.select().from(users).where(eq(users.username, email)).limit(1);
      if (u) {
        await db.update(users).set({ [idKey]: profile.unionId }).where(eq(users.id, u.id));
        matchedByEmail = true;
        console.info(`[auth/${p}] bound identity to existing user ${u.username} via email ${email}`);
      }
    }
    if (!u) {
      const displayName =
        profile.name || `${providerLabel(p)}用户 ${profile.unionId.slice(0, 8)}`;
      const username = await pickUsername(profile.email, `${p}_${profile.unionId.slice(0, 8)}`);
      await db
        .insert(users)
        .values({
          id: crypto.randomUUID(),
          username,
          name: displayName,
          passwordHash: '!oauth',
          role: 'member',
          [idKey]: profile.unionId,
          avatarUrl: profile.avatarUrl ?? null,
        })
        .onConflictDoNothing();
      [u] = await db.select().from(users).where(eq(users[idKey], profile.unionId)).limit(1);
      if (!u) throw new Error('user upsert failed');
      if (profile.email) {
        await upsertVerifiedEmail(u.id, profile.email);
        const claimed = await claimExternalInvites(u, profile.email);
        if (claimed > 0) {
          console.info(`[auth/${p}] ${u.username} claimed ${claimed} external invite(s)`);
        }
      }
      // 把 OAuth 昵称/头像同步到认领的（以及所有）member 投影行。
      await syncMemberProjection(u);
    } else {
      // 老用户登录：name 只在首次建号时写入，之后不再覆盖（用户可自行修改）；
      // 仅头像跟随 OAuth 资料刷新并同步 member 投影。
      if (profile.email) {
        await upsertVerifiedEmail(u.id, profile.email);
        // 邮箱匹配绑定视同一次验证事件：该邮箱升级为 verified 后立即认领邀请。
        if (matchedByEmail) {
          const claimed = await claimExternalInvites(u, profile.email);
          if (claimed > 0) {
            console.info(`[auth/${p}] ${u.username} claimed ${claimed} external invite(s)`);
          }
        }
      }
      const avatarUrl = profile.avatarUrl ?? null;
      if (u.avatarUrl !== avatarUrl) {
        await db.update(users).set({ avatarUrl }).where(eq(users.id, u.id));
        await syncMemberProjection({ id: u.id, name: u.name, avatarUrl });
        u.avatarUrl = avatarUrl;
      }
    }

    const company = await defaultCompanyForUser(u);
    if (company) await ensureCurrentMember(u, company.id);
    const c = await createSessionCookie(u, company?.id);
    const res = NextResponse.redirect(new URL('/issues', req.url), 302);
    res.cookies.delete(LOGIN_STATE_COOKIE); // nonce 一次性使用
    res.cookies.set(c.name, c.value, c.options);
    return res;
  } catch (e) {
    console.error(`[auth/${p}] callback failed:`, e);
    return loginFail(req, p, 'exchange');
  }
}
