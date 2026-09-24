import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { oauthProviderConfigs } from '@/db/schema';
import { env } from '@/lib/env';
import { ApiException, ok } from '@/lib/envelope';
import { decryptSecret, encryptSecret } from '@/server/crypto';
import { jsonBody, publicOrigin, requireActor, requireAdmin, route } from '@/server/http';
import { getProviderConf, invalidateOAuthConfigCache, parseProvider, type OAuthProvider } from '@/server/lark';

/* GET/PUT/DELETE /api/v1/platform/oauth-providers — 平台管理员在 设置→三方登录
   管理飞书/Lark/GitHub 的登录凭据。DB 行为权威配置(加密存 secret),无行的
   provider 回退 env(来源标记 source: 'db'|'env'|null);全局生效来源由
   OAUTH_CONFIG_SOURCE 决定(GET 回 configSource: 'auto'|'db'|'env'——
   'env' 时 DB 配置不生效,'db' 时 env 不兜底)。secret 永不回显:
   GET 只回 hasSecret;PUT 不传 appSecret = 保留旧值。 */

const PROVIDERS: OAuthProvider[] = ['feishu', 'lark', 'github'];

/* 回调地址只存路径部分（host 运行时由 PUBLIC_ORIGIN 拼接）——管理员若粘贴
   完整 URL 则剥掉 origin，其他输入补前导斜杠。 */
function toPathOnly(v: string): string {
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      return u.pathname + u.search;
    } catch {
      /* fall through to the plain-path branch */
    }
  }
  return v.startsWith('/') ? v : `/${v}`;
}

interface PutBody {
  provider: string;
  appId?: string;
  appSecret?: string;
  redirectUri?: string | null;
  enabled?: boolean;
}

export const GET = route(async (req) => {
  const actor = await requireActor();
  requireAdmin(actor);
  const origin = publicOrigin(req);
  const rows = await db.select().from(oauthProviderConfigs);
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  const list = await Promise.all(
    PROVIDERS.map(async (p) => {
      const row = byProvider.get(p);
      const conf = await getProviderConf(p); // DB(启用) → env 兜底
      return {
        provider: p,
        configured: conf !== null,
        source: conf?.source ?? null,
        enabled: row?.enabled ?? null, // null = 无 DB 行
        appId: row?.appId ?? (conf?.source === 'env' ? conf.appId : null),
        redirectUri: row?.redirectUri ?? null,
        derivedRedirectPath: `/api/auth/${p}/callback`,
        derivedRedirectUri: `${origin}/api/auth/${p}/callback`,
        hasSecret: row ? !!row.appSecretEnc : conf?.source === 'env',
      };
    }),
  );
  return ok({ configSource: env.oauthConfigSource, providers: list });
});

export const PUT = route(async (req) => {
  const actor = await requireActor();
  requireAdmin(actor);
  const body = await jsonBody<PutBody>(req);
  const p = parseProvider(body.provider ?? '');
  if (!p) throw new ApiException('VALIDATION_FAILED', '未知的登录提供方');
  const appId = body.appId?.trim();
  if (!appId) throw new ApiException('VALIDATION_FAILED', 'App ID 不能为空');

  const [existing] = await db
    .select()
    .from(oauthProviderConfigs)
    .where(eq(oauthProviderConfigs.provider, p))
    .limit(1);
  const appSecret = body.appSecret?.trim();
  if (!existing && !appSecret) throw new ApiException('VALIDATION_FAILED', '首次保存必须填写 App Secret');
  // 验证新 secret 能加密(CONFIG_CRYPTO_KEY 缺失时这里就报错,而不是落库后读不出来)。
  const appSecretEnc = appSecret ? encryptSecret(appSecret) : existing!.appSecretEnc;
  if (appSecret) decryptSecret(appSecretEnc); // round-trip 自检

  const rawRedirect = body.redirectUri === undefined ? existing?.redirectUri : body.redirectUri?.trim() || null;
  const redirectUri = rawRedirect ? toPathOnly(rawRedirect) : rawRedirect;
  const enabled = body.enabled ?? existing?.enabled ?? true;
  const values = { appId, appSecretEnc, redirectUri, enabled, updatedAt: new Date() };
  if (existing) {
    await db.update(oauthProviderConfigs).set(values).where(eq(oauthProviderConfigs.provider, p));
  } else {
    await db.insert(oauthProviderConfigs).values({ provider: p, ...values });
  }
  invalidateOAuthConfigCache();
  return ok({ provider: p, enabled, hasSecret: true });
});

export const DELETE = route(async (req) => {
  const actor = await requireActor();
  requireAdmin(actor);
  const p = parseProvider(req.nextUrl.searchParams.get('provider') ?? '');
  if (!p) throw new ApiException('VALIDATION_FAILED', '未知的登录提供方');
  await db.delete(oauthProviderConfigs).where(eq(oauthProviderConfigs.provider, p));
  invalidateOAuthConfigCache();
  return ok({ provider: p });
});
