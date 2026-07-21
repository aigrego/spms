import { env } from '@/lib/env';

/* Lark (飞书) OAuth helpers. Lark login is enabled only when both
   LARK_APP_ID and LARK_APP_SECRET are set; the redirect URI defaults to
   <origin>/api/auth/lark/callback unless LARK_REDIRECT_URI overrides it. */

export function larkConfigured(): boolean {
  return !!(env.larkAppId && env.larkAppSecret);
}

export function larkRedirectUri(origin: string): string {
  return env.larkRedirectUri ?? `${origin}/api/auth/lark/callback`;
}

/* The feishu authorization URL the browser is sent to (302). state is a
   one-off nonce — no cross-request state check (single-tenant tool). */
export function larkAuthorizeUrl(origin: string): string {
  const redirect = encodeURIComponent(larkRedirectUri(origin));
  return `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${env.larkAppId}&redirect_uri=${redirect}&state=${crypto.randomUUID()}`;
}
