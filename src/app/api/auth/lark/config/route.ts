import { ok } from '@/lib/envelope';
import { route } from '@/server/http';
import { larkAuthorizeUrl, larkConfigured } from '@/server/lark';

/* GET /api/auth/lark/config → { configured, url? }. The login page shows the
   飞书扫码登录 button only when configured, linking `url` (falling back to
   /api/auth/lark/login). */
export const GET = route(async (req) => {
  const configured = larkConfigured();
  return ok({ configured, url: configured ? larkAuthorizeUrl(req.nextUrl.origin) : undefined });
});
