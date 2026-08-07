import { env } from '@/lib/env';

/* OAuth provider helpers. Feishu (飞书, CN) / Lark (international) run on
   separate open platforms (open.feishu.cn vs open.larksuite.com); GitHub is an
   OAuth App (https://github.com/settings/developers). Each provider is enabled
   only when its env vars are set. The redirect URI defaults to
   <origin>/api/auth/<provider>/callback unless the env override is set. */

export type OAuthProvider = 'feishu' | 'lark' | 'github';

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
  github: {
    apiBase: 'https://github.com',
    appId: env.githubClientId,
    appSecret: env.githubClientSecret,
    redirectUri: env.githubRedirectUri,
  },
};

export function parseProvider(raw: string): OAuthProvider | null {
  return raw === 'feishu' || raw === 'lark' || raw === 'github' ? raw : null;
}

export function providerConfigured(p: OAuthProvider): boolean {
  return !!(PROVIDERS[p].appId && PROVIDERS[p].appSecret);
}

export function providerRedirectUri(p: OAuthProvider, origin: string): string {
  return PROVIDERS[p].redirectUri ?? `${origin}/api/auth/${p}/callback`;
}

/* The authorization URL the browser is sent to (302). Both flows carry a
   cross-request state nonce that the callback verifies against an HttpOnly
   cookie (login-CSRF guard): login flows pass `login.<nonce>`
   (LOGIN_STATE_COOKIE, set by /login), bind flows pass `bind.<nonce>`
   (BIND_STATE_COOKIE, set by /bind). */
export function providerAuthorizeUrl(p: OAuthProvider, origin: string, state?: string): string {
  const redirect = encodeURIComponent(providerRedirectUri(p, origin));
  if (p === 'github') {
    // scope 只要 read:user + user:email（公开资料 + 邮箱）。
    const scope = encodeURIComponent('read:user user:email');
    return `${PROVIDERS.github.apiBase}/login/oauth/authorize?client_id=${PROVIDERS.github.appId}&redirect_uri=${redirect}&scope=${scope}&state=${state ?? crypto.randomUUID()}`;
  }
  return `${PROVIDERS[p].apiBase}/open-apis/authen/v1/authorize?app_id=${PROVIDERS[p].appId}&redirect_uri=${redirect}&state=${state ?? crypto.randomUUID()}`;
}

/* HttpOnly cookie carrying the login-flow nonce between /api/auth/<p>/login
   and the callback — proves the login was initiated by this browser (CSRF
   guard), same idea as BIND_STATE_COOKIE for the bind flow. */
export const LOGIN_STATE_COOKIE = 'spms_oauth_login';

/* HttpOnly cookie carrying the bind-flow nonce between /api/auth/<p>/bind and
   the callback — proves the bind was initiated by this browser (CSRF guard). */
export const BIND_STATE_COOKIE = 'spms_oauth_bind';

export interface OAuthProfile {
  unionId: string;
  name: string;
  // 邮箱用于匹配「邀请外部资源」预埋的 members.email。飞书/Lark user_info 的
  // email / enterprise_email 字段需要应用开通对应 scope 并重新发布后才返回；
  // GitHub 用户隐藏邮箱时 /user 返回 null（改走 /user/emails）。拿不到时为
  // undefined（退化为仅按稳定 id 匹配）。
  email?: string;
  // 头像；基础资料字段，无需额外 scope。
  avatarUrl?: string;
}

/* authorization code → app_access_token → user_access_token → user_info
   (GitHub: code → access_token → /user + /user/emails). The returned unionId
   is the stable cross-app identity (GitHub: numeric id stringified).
   Throws on any failure. */
export async function fetchOAuthProfile(p: OAuthProvider, code: string): Promise<OAuthProfile> {
  if (p === 'github') return fetchGithubProfile(code);
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

/* GitHub: authorization code → access_token → GET /user → GET /user/emails.
   /user 的 email 字段在用户隐藏邮箱时为 null，所以邮箱固定走 /user/emails
   （primary && verified 优先，退化第一个 verified，再退化 undefined）。 */
async function fetchGithubProfile(code: string): Promise<OAuthProfile> {
  const conf = PROVIDERS.github;

  // 1) code → access_token。必须带 Accept: application/json，否则返回 form 编码；
  //    失败时 GitHub 仍返回 200，错误在 body 的 error 字段。
  const tokRes = await fetch(`${conf.apiBase}/login/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: conf.appId,
      client_secret: conf.appSecret,
      code,
      redirect_uri: conf.redirectUri,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokRes.ok) throw new Error(`github access_token failed (status=${tokRes.status})`);
  const tok = (await tokRes.json()) as { access_token?: string; error?: string };
  if (!tok.access_token) throw new Error(`github access_token failed (${tok.error ?? 'unknown'})`);

  const headers = {
    Authorization: `Bearer ${tok.access_token}`,
    Accept: 'application/vnd.github+json',
  };

  // 2) 用户资料（id / login / name / avatar_url）。
  const userRes = await fetch('https://api.github.com/user', {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!userRes.ok) throw new Error(`github /user failed (status=${userRes.status})`);
  const user = (await userRes.json()) as {
    id?: number;
    login?: string;
    name?: string | null;
    avatar_url?: string;
  };
  if (!user.id || !user.login) throw new Error('github /user missing id/login');

  // 3) 邮箱：primary && verified 优先。
  const emailsRes = await fetch('https://api.github.com/user/emails', {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!emailsRes.ok) throw new Error(`github /user/emails failed (status=${emailsRes.status})`);
  const emailList = (await emailsRes.json()) as { email?: string; primary?: boolean; verified?: boolean }[];
  const verified = Array.isArray(emailList) ? emailList.filter((e) => e.verified && e.email) : [];
  const email = verified.find((e) => e.primary)?.email ?? verified[0]?.email;

  return {
    unionId: String(user.id),
    name: user.name?.trim() || user.login,
    email,
    avatarUrl: user.avatar_url || undefined,
  };
}
