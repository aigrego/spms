import { NextResponse } from 'next/server';
import { fail } from '@/lib/envelope';
import { route } from '@/server/http';
import { larkAuthorizeUrl, larkConfigured } from '@/server/lark';

/* GET /api/auth/lark → 302 to the feishu authorization page.
   Alias of /api/auth/lark/login (docs/API.md lists this shorter path). */
export const GET = route(async (req) => {
  if (!larkConfigured()) return fail('NOT_FOUND', '飞书登录未配置', 404);
  return NextResponse.redirect(larkAuthorizeUrl(req.nextUrl.origin), 302);
});
