import { ok } from '@/lib/envelope';
import { route } from '@/server/http';
import { providerConfigured, type OAuthProvider } from '@/server/lark';

/* GET /api/auth/oauth/config → { feishu: {...}, lark: {...}, github: {...} }.
   The login page shows each third-party button only when that provider is
   configured. `url` 一律指向 /api/auth/<provider>/login 入口路由(它会签发
   state nonce cookie 再 302 去 provider)——不能直接给 provider 授权 URL,
   否则 callback 的 state 校验因无 cookie 必失败。 */
export const GET = route(async () => {
  const entry = (p: OAuthProvider) => ({
    configured: providerConfigured(p),
    url: providerConfigured(p) ? `/api/auth/${p}/login` : undefined,
  });
  return ok({ feishu: entry('feishu'), lark: entry('lark'), github: entry('github') });
});
