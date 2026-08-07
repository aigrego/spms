import { NextResponse } from 'next/server';
import { fail } from '@/lib/envelope';
import { route } from '@/server/http';
import { LOGIN_STATE_COOKIE, parseProvider, providerAuthorizeUrl, providerConfigured } from '@/server/lark';

/* GET /api/auth/<feishu|lark|github>/login → 302 to the provider's authorization
   page. 404 when the provider's env is not configured. 与 bind 流程同理:签发
   HttpOnly nonce cookie,state 带 login.<nonce>,callback 校验通过才放行
   (防登录 CSRF)。 */
export const GET = route(async (req, ctx: { params: Promise<{ provider: string }> }) => {
  const p = parseProvider((await ctx.params).provider);
  if (!p) return fail('NOT_FOUND', '未知的登录提供方', 404);
  if (!providerConfigured(p)) return fail('NOT_FOUND', '第三方登录未配置', 404);
  const nonce = crypto.randomUUID();
  const res = NextResponse.redirect(providerAuthorizeUrl(p, req.nextUrl.origin, `login.${nonce}`), 302);
  res.cookies.set(LOGIN_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 min to finish the authorization
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
});
