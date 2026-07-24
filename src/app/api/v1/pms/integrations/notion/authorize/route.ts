import { NextResponse } from 'next/server';
import { fail } from '@/lib/envelope';
import { requirePerm } from '@/lib/permissions';
import { requireActor, route } from '@/server/http';
import { NOTION_STATE_COOKIE, notionAuthorizeUrl, notionConfigured } from '@/server/notion';

/* GET /api/v1/pms/integrations/notion/authorize — start the Notion OAuth flow:
   requires a session + issues write perm, stashes a nonce in an HttpOnly
   cookie (CSRF guard) and 302s to Notion's authorization page. 404 when the
   integration env is not configured. */
export const GET = route(async (req) => {
  if (!notionConfigured()) return fail('NOT_FOUND', 'Notion 集成未配置', 404);
  const actor = await requireActor();
  await requirePerm(actor, 'issues', 'write');
  const nonce = crypto.randomUUID();
  const res = NextResponse.redirect(notionAuthorizeUrl(req.nextUrl.origin, nonce), 302);
  res.cookies.set(NOTION_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 min to finish the authorization
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
});
