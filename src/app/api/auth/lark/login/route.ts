import { NextResponse } from 'next/server';
import { fail } from '@/lib/envelope';
import { route } from '@/server/http';
import { larkAuthorizeUrl, larkConfigured } from '@/server/lark';

/* GET /api/auth/lark/login → 302 to the feishu authorization page.
   404 when Lark env is not configured. */
export const GET = route(async (req) => {
  if (!larkConfigured()) return fail('NOT_FOUND', '飞书登录未配置', 404);
  return NextResponse.redirect(larkAuthorizeUrl(req.nextUrl.origin), 302);
});
