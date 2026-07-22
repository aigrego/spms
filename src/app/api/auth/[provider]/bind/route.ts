import { NextResponse } from 'next/server';
import { fail } from '@/lib/envelope';
import { requireUser } from '@/lib/session';
import { route } from '@/server/http';
import { BIND_STATE_COOKIE, parseProvider, providerAuthorizeUrl, providerConfigured } from '@/server/lark';

/* GET /api/auth/<feishu|lark>/bind — start the OAuth flow in "bind" mode:
   requires an active session (the account the identity will be linked to),
   stashes a nonce in an HttpOnly cookie and sends the browser to the
   provider's authorization page with state=bind.<nonce>. The callback
   verifies the nonce before linking. */
export const GET = route(async (req, ctx: { params: Promise<{ provider: string }> }) => {
  const p = parseProvider((await ctx.params).provider);
  if (!p) return fail('NOT_FOUND', '未知的登录提供方', 404);
  if (!providerConfigured(p)) return fail('NOT_FOUND', '第三方登录未配置', 404);
  await requireUser(); // 401 via route() when logged out
  const nonce = crypto.randomUUID();
  const res = NextResponse.redirect(providerAuthorizeUrl(p, req.nextUrl.origin, `bind.${nonce}`), 302);
  res.cookies.set(BIND_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 min to finish the authorization
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
});
