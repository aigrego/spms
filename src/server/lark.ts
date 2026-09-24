import { db } from '@/db';
import { oauthProviderConfigs } from '@/db/schema';
import { env } from '@/lib/env';
import { decryptSecret } from '@/server/crypto';
import { normalizePhone } from '@/lib/identity';
import { joinOriginPath } from '@/lib/url';

/* OAuth provider helpers. Feishu (飞书, CN) / Lark (international) run on
   separate open platforms (open.feishu.cn vs open.larksuite.com); GitHub is an
   OAuth App (https://github.com/settings/developers). Credentials come from
   设置 → 三方登录 (oauth_provider_configs table, secrets AES-256-GCM
   encrypted) or the FEISHU_/LARK_/GITHUB_-prefixed env vars, selected by
   OAUTH_CONFIG_SOURCE: 'auto' (default) = enabled DB row first, env fallback;
   'db' = DB only; 'env' = env only (DB rows ignored). The redirect URI
   defaults to <origin>/api/auth/<provider>/callback; a DB/env override stores
   only the path part — the host is joined from PUBLIC_ORIGIN (or the request
   origin) at use time. */

export type OAuthProvider = 'feishu' | 'lark' | 'github';

export interface ProviderConf {
  apiBase: string;
  appId: string;
  appSecret: string;
  redirectUri?: string;
  source: 'db' | 'env';
}

const API_BASE: Record<OAuthProvider, string> = {
  feishu: 'https://open.feishu.cn',
  lark: 'https://open.larksuite.com',
  github: 'https://github.com',
};

function envConf(p: OAuthProvider): ProviderConf | null {
  const c =
    p === 'feishu'
      ? { appId: env.feishuAppId, appSecret: env.feishuAppSecret, redirectUri: env.feishuRedirectUri }
      : p === 'lark'
        ? { appId: env.larkAppId, appSecret: env.larkAppSecret, redirectUri: env.larkRedirectUri }
        : { appId: env.githubClientId, appSecret: env.githubClientSecret, redirectUri: env.githubRedirectUri };
  if (!c.appId || !c.appSecret) return null;
  return { apiBase: API_BASE[p], appId: c.appId, appSecret: c.appSecret, redirectUri: c.redirectUri, source: 'env' };
}

/* 60s process-local cache (same pattern as the permissions matrix) — OAuth
   config changes are rare; invalidateOAuthConfigCache() forces a reload. */
let cache: { at: number; map: Partial<Record<OAuthProvider, ProviderConf | null>> } | null = null;

export function invalidateOAuthConfigCache() {
  cache = null;
}

/* Config source is switched by OAUTH_CONFIG_SOURCE (see src/lib/env.ts):
   auto = enabled DB row first, env fallback; db = DB only; env = env only.
   Null = not configured. */
export async function getProviderConf(p: OAuthProvider): Promise<ProviderConf | null> {
  const mode = env.oauthConfigSource;
  if (mode === 'env') return envConf(p);
  if (!cache || Date.now() - cache.at > 60_000) {
    const rows = await db.select().from(oauthProviderConfigs);
    const map: Partial<Record<OAuthProvider, ProviderConf | null>> = {};
    for (const r of rows) {
      const prov = parseProvider(r.provider);
      if (!prov) continue;
      if (!r.enabled) {
        map[prov] = null;
        continue;
      }
      try {
        map[prov] = {
          apiBase: API_BASE[prov],
          appId: r.appId,
          appSecret: decryptSecret(r.appSecretEnc),
          redirectUri: r.redirectUri ?? undefined,
          source: 'db',
        };
      } catch (e) {
        console.error(`[oauth] ${prov} 密钥解密失败（CONFIG_CRYPTO_KEY 变更？），忽略该行:`, e);
        map[prov] = null;
      }
    }
    cache = { at: Date.now(), map };
  }
  const fromDb = cache.map[p];
  return mode === 'db' ? (fromDb ?? null) : (fromDb ?? envConf(p));
}

export function parseProvider(raw: string): OAuthProvider | null {
  return raw === 'feishu' || raw === 'lark' || raw === 'github' ? raw : null;
}

export async function providerConfigured(p: OAuthProvider): Promise<boolean> {
  return (await getProviderConf(p)) !== null;
}

/* Absolute redirect_uri for a provider: the DB/env override is a path joined
   onto the origin; absolute http(s) overrides pass through (legacy configs). */
function absoluteRedirectUri(p: OAuthProvider, conf: ProviderConf | null, origin: string): string {
  return conf?.redirectUri
    ? joinOriginPath(origin, conf.redirectUri)
    : `${origin}/api/auth/${p}/callback`;
}

export async function providerRedirectUri(p: OAuthProvider, origin: string): Promise<string> {
  return absoluteRedirectUri(p, await getProviderConf(p), origin);
}

/* The authorization URL the browser is sent to (302). Both flows carry a
   cross-request state nonce that the callback verifies against an HttpOnly
   cookie (login-CSRF guard): login flows pass `login.<nonce>`
   (LOGIN_STATE_COOKIE, set by /login), bind flows pass `bind.<nonce>`
   (BIND_STATE_COOKIE, set by /bind). */
export async function providerAuthorizeUrl(p: OAuthProvider, origin: string, state?: string): Promise<string> {
  const conf = await getProviderConf(p);
  if (!conf) throw new Error(`provider ${p} not configured`);
  const redirect = encodeURIComponent(absoluteRedirectUri(p, conf, origin));
  if (p === 'github') {
    // scope 只要 read:user + user:email（公开资料 + 邮箱）。
    const scope = encodeURIComponent('read:user user:email');
    return `${conf.apiBase}/login/oauth/authorize?client_id=${conf.appId}&redirect_uri=${redirect}&scope=${scope}&state=${state ?? crypto.randomUUID()}`;
  }
  return `${conf.apiBase}/open-apis/authen/v1/authorize?app_id=${conf.appId}&redirect_uri=${redirect}&state=${state ?? crypto.randomUUID()}`;
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
  // 首选邮箱（个人邮箱优先，其次企业邮箱）：仅作 username 候选与展示。
  // 飞书/Lark user_info 的 email / enterprise_email 字段需要应用开通对应
  // scope 并重新发布后才返回；GitHub 用户隐藏邮箱时 /user 返回 null（改走
  // /user/emails）。拿不到时为 undefined。
  email?: string;
  // IdP 返回的全部邮箱（个人 + 企业，去重）：每个都登记 verified、都参与
  // 邀请认领匹配。无邮箱账号（如豆包系飞书账号）为空数组。
  emails: string[];
  // 手机号（飞书/Lark 需 contact:user.phone:readonly scope），归一化为纯
  // 数字；无邮箱账号的主要认领键。
  mobile?: string;
  // 头像；基础资料字段，无需额外 scope。
  avatarUrl?: string;
}

/* authorization code → app_access_token → user_access_token → user_info
   (GitHub: code → access_token → /user + /user/emails). The returned unionId
   is the stable cross-app identity (GitHub: numeric id stringified).
   `origin` recomposes the absolute redirect_uri for the token exchange — it
   must match the value sent in the authorize URL. Throws on any failure. */
export async function fetchOAuthProfile(p: OAuthProvider, code: string, origin: string): Promise<OAuthProfile> {
  if (p === 'github') return fetchGithubProfile(code, origin);
  const conf = await getProviderConf(p);
  if (!conf) throw new Error(`provider ${p} not configured`);

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
      mobile?: string;
      avatar_url?: string;
      avatar_middle?: string;
      avatar_big?: string;
    };
  };
  const unionId = info.data?.union_id;
  if (info.code !== 0 || !unionId) throw new Error(`user_info failed (code=${info.code})`);
  const emails = [
    ...new Set(
      [info.data?.email?.trim(), info.data?.enterprise_email?.trim()].filter(
        (v): v is string => !!v,
      ),
    ),
  ];
  return {
    unionId,
    name: info.data?.name?.trim() || '',
    email: emails[0],
    emails,
    mobile: normalizePhone(info.data?.mobile) || undefined,
    avatarUrl: info.data?.avatar_big || info.data?.avatar_middle || info.data?.avatar_url || undefined,
  };
}

/* GitHub: authorization code → access_token → GET /user → GET /user/emails.
   /user 的 email 字段在用户隐藏邮箱时为 null，所以邮箱固定走 /user/emails
   （primary && verified 优先，退化第一个 verified，再退化 undefined）。 */
async function fetchGithubProfile(code: string, origin: string): Promise<OAuthProfile> {
  const conf = await getProviderConf('github');
  if (!conf) throw new Error('provider github not configured');

  // 1) code → access_token。必须带 Accept: application/json，否则返回 form 编码；
  //    失败时 GitHub 仍返回 200，错误在 body 的 error 字段。
  const tokRes = await fetch(`${conf.apiBase}/login/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: conf.appId,
      client_secret: conf.appSecret,
      code,
      redirect_uri: absoluteRedirectUri('github', conf, origin),
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
    emails: email ? [email] : [],
    avatarUrl: user.avatar_url || undefined,
  };
}
