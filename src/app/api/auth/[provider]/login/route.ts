import { NextResponse } from 'next/server';
import { fail } from '@/lib/envelope';
import { route } from '@/server/http';
import { parseProvider, providerAuthorizeUrl, providerConfigured } from '@/server/lark';

/* GET /api/auth/<feishu|lark>/login → 302 to the provider's authorization page.
   404 when the provider's env is not configured. */
export const GET = route(async (req, ctx: { params: Promise<{ provider: string }> }) => {
  const p = parseProvider((await ctx.params).provider);
  if (!p) return fail('NOT_FOUND', '未知的登录提供方', 404);
  if (!providerConfigured(p)) return fail('NOT_FOUND', '第三方登录未配置', 404);
  return NextResponse.redirect(providerAuthorizeUrl(p, req.nextUrl.origin), 302);
});
