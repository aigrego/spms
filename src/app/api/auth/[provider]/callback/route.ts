import { NextRequest, NextResponse } from 'next/server';
import { ensureCurrentMember } from '@/lib/identity';
import { createSessionCookie, getSession } from '@/lib/session';
import { defaultCompanyForUser, publicOrigin } from '@/server/http';
import { BIND_STATE_COOKIE, LOGIN_STATE_COOKIE, fetchOAuthProfile, parseProvider, providerConfigured } from '@/server/lark';
import { bindOAuthIdentity, loginWithOAuthProfile } from '@/server/services/oauth';

function loginFail(req: NextRequest, provider: string, reason?: string) {
  const url = new URL(`/login?error=${provider}`, publicOrigin(req));
  // 失败环节带上 reason(state/code/exchange),生产排障只看 URL 就能区分
  // state 校验失败 / 缺少 code / 换取 token 或落库失败。
  if (reason) url.searchParams.set('reason', reason);
  const res = NextResponse.redirect(url, 302);
  res.cookies.delete(LOGIN_STATE_COOKIE);
  return res;
}

function bindResult(req: NextRequest, result: 'bound' | 'taken' | 'failed') {
  const url = new URL('/profile/security', publicOrigin(req));
  url.searchParams.set('oauth', result);
  const res = NextResponse.redirect(url, 302);
  res.cookies.delete(BIND_STATE_COOKIE);
  return res;
}

/* GET /api/auth/<feishu|lark|github>/callback?code=...&state=...
   Two modes, selected by `state`:
   - state=bind.<nonce> (from /api/auth/<p>/bind): verify the nonce cookie and
     the active session, then link the provider identity onto THAT user (no new
     account, no re-login) → 302 /profile/security?oauth=bound|taken|failed.
   - state=login.<nonce> (from /api/auth/<p>/login): verify the nonce cookie
     (login CSRF guard), then hand the IdP profile to
     services/oauth.loginWithOAuthProfile（身份命中登录 / 邮箱匹配绑定 / 建号 +
     邮箱登记 + 外部邀请认领）→ session cookie → 302 /issues。
     任何失败跳 /login?error=<provider>。
   账号编排与 DB 逻辑在 @/server/services/oauth；本路由只保留 Web 细节
   （state nonce cookie 校验、code 换取 profile、重定向与 session cookie）。 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
) {
  const raw = (await ctx.params).provider;
  const p = parseProvider(raw);
  if (!p || !(await providerConfigured(p))) return loginFail(req, raw);
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
      const profile = await fetchOAuthProfile(p, code, publicOrigin(req));
      return bindResult(req, await bindOAuthIdentity(session.uid, p, profile));
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
    const profile = await fetchOAuthProfile(p, code, publicOrigin(req));
    const u = await loginWithOAuthProfile(p, profile);
    const company = await defaultCompanyForUser(u);
    if (company) await ensureCurrentMember(u, company.id);
    const c = await createSessionCookie(u, company?.id);
    const res = NextResponse.redirect(new URL('/issues', publicOrigin(req)), 302);
    res.cookies.delete(LOGIN_STATE_COOKIE); // nonce 一次性使用
    res.cookies.set(c.name, c.value, c.options);
    return res;
  } catch (e) {
    console.error(`[auth/${p}] callback failed:`, e);
    return loginFail(req, p, 'exchange');
  }
}
