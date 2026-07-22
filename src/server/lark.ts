import { env } from '@/lib/env';

/* Feishu (飞书, CN) / Lark (international) OAuth helpers. The two products run
   on separate open platforms (open.feishu.cn vs open.larksuite.com) and require
   separate apps; each provider is enabled only when its *_APP_ID / *_APP_SECRET
   env vars are set. The redirect URI defaults to <origin>/api/auth/<provider>/callback
   unless <PROVIDER>_REDIRECT_URI overrides it. */

export type OAuthProvider = 'feishu' | 'lark';

interface ProviderConf {
  apiBase: string;
  appId?: string;
  appSecret?: string;
  redirectUri?: string;
}

const PROVIDERS: Record<OAuthProvider, ProviderConf> = {
  feishu: {
    apiBase: 'https://open.feishu.cn',
    appId: env.feishuAppId,
    appSecret: env.feishuAppSecret,
    redirectUri: env.feishuRedirectUri,
  },
  lark: {
    apiBase: 'https://open.larksuite.com',
    appId: env.larkAppId,
    appSecret: env.larkAppSecret,
    redirectUri: env.larkRedirectUri,
  },
};

export function parseProvider(raw: string): OAuthProvider | null {
  return raw === 'feishu' || raw === 'lark' ? raw : null;
}

export function providerConfigured(p: OAuthProvider): boolean {
  return !!(PROVIDERS[p].appId && PROVIDERS[p].appSecret);
}

export function providerRedirectUri(p: OAuthProvider, origin: string): string {
  return PROVIDERS[p].redirectUri ?? `${origin}/api/auth/${p}/callback`;
}

/* The authorization URL the browser is sent to (302). Login flows use a
   one-off random state — no cross-request state check (single-tenant tool);
   bind flows pass `bind.<nonce>` and the nonce is verified against
   BIND_STATE_COOKIE in the callback. */
export function providerAuthorizeUrl(p: OAuthProvider, origin: string, state?: string): string {
  const redirect = encodeURIComponent(providerRedirectUri(p, origin));
  return `${PROVIDERS[p].apiBase}/open-apis/authen/v1/authorize?app_id=${PROVIDERS[p].appId}&redirect_uri=${redirect}&state=${state ?? crypto.randomUUID()}`;
}

/* HttpOnly cookie carrying the bind-flow nonce between /api/auth/<p>/bind and
   the callback — proves the bind was initiated by this browser (CSRF guard). */
export const BIND_STATE_COOKIE = 'spms_oauth_bind';

export interface OAuthProfile {
  unionId: string;
  name: string;
  // 邮箱用于匹配「邀请外部资源」预埋的 members.email。user_info 的 email /
  // enterprise_email 字段需要应用开通对应 scope（contact:user.email:readonly
  // 等）并重新发布后才返回；拿不到时为 undefined（退化为仅 union_id 匹配）。
  email?: string;
  // 头像（avatar_big 优先）；user_info 基础字段，无需额外 scope。
  avatarUrl?: string;
}

/* authorization code → app_access_token → user_access_token → user_info.
   union_id is the stable cross-app identity. Throws on any failure. */
export async function fetchOAuthProfile(p: OAuthProvider, code: string): Promise<OAuthProfile> {
  const conf = PROVIDERS[p];

  // 1) app_access_token — the app-level credential.
  const appTokRes = await fetch(`${conf.apiBase}/open-apis/auth/v3/app_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: conf.appId, app_secret: conf.appSecret }),
    signal: AbortSignal.timeout(10_000),
  });
  const appTok = (await appTokRes.json()) as { code?: number; app_access_token?: string };
  if (appTok.code !== 0 || !appTok.app_access_token) {
    throw new Error(`app_access_token failed (code=${appTok.code})`);
  }

  // 2) authorization code → user_access_token.
  const userTokRes = await fetch(`${conf.apiBase}/open-apis/authen/v1/oidc/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${appTok.app_access_token}`,
    },
    body: JSON.stringify({ grant_type: 'authorization_code', code }),
    signal: AbortSignal.timeout(10_000),
  });
  const userTok = (await userTokRes.json()) as { code?: number; data?: { access_token?: string } };
  const userAccessToken = userTok.data?.access_token;
  if (userTok.code !== 0 || !userAccessToken) {
    throw new Error(`oidc access_token failed (code=${userTok.code})`);
  }

  // 3) the user's profile.
  const infoRes = await fetch(`${conf.apiBase}/open-apis/authen/v1/user_info`, {
    headers: { Authorization: `Bearer ${userAccessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  const info = (await infoRes.json()) as {
    code?: number;
    data?: {
      union_id?: string;
      name?: string;
      email?: string;
      enterprise_email?: string;
      avatar_url?: string;
      avatar_middle?: string;
      avatar_big?: string;
    };
  };
  const unionId = info.data?.union_id;
  if (info.code !== 0 || !unionId) throw new Error(`user_info failed (code=${info.code})`);
  return {
    unionId,
    name: info.data?.name?.trim() || '',
    email: info.data?.email?.trim() || info.data?.enterprise_email?.trim() || undefined,
    avatarUrl: info.data?.avatar_big || info.data?.avatar_middle || info.data?.avatar_url || undefined,
  };
}
