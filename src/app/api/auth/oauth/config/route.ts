import { ok } from '@/lib/envelope';
import { route } from '@/server/http';
import { providerAuthorizeUrl, providerConfigured, type OAuthProvider } from '@/server/lark';

/* GET /api/auth/oauth/config → { feishu: { configured, url? }, lark: {...} }.
   The login page shows each third-party button only when that provider is
   configured, linking `url` (falling back to /api/auth/<provider>/login). */
export const GET = route(async (req) => {
  const entry = (p: OAuthProvider) => ({
    configured: providerConfigured(p),
    url: providerConfigured(p) ? providerAuthorizeUrl(p, req.nextUrl.origin) : undefined,
  });
  return ok({ feishu: entry('feishu'), lark: entry('lark') });
});
