import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { oauthProviderConfigs, users } from '@/db/schema';
import { findUserByEmail, upsertVerifiedEmail } from '@/lib/emails';
import { env } from '@/lib/env';
import { ApiException } from '@/lib/envelope';
import { claimExternalInvites, syncMemberProjection } from '@/lib/identity';
import { decryptSecret, encryptSecret } from '@/server/crypto';
import {
  getProviderConf,
  invalidateOAuthConfigCache,
  parseProvider,
  type OAuthProfile,
  type OAuthProvider,
} from '@/server/lark';
import type { Actor } from './types';

/* OAuth 域业务逻辑（/api/v1/platform/oauth-providers 与
   /api/auth/<provider>/callback 的薄路由共用这里）：

   1) 三方登录提供方配置管理（平台管理员 设置→三方登录）—— DB 行为权威配置
      （加密存 secret），无行的 provider 回退 env（来源标记 source:
      'db'|'env'|null）；全局生效来源由 OAUTH_CONFIG_SOURCE 决定（'env' 时
      DB 配置不生效，'db' 时 env 不兜底）。secret 永不回显：读取只回
      hasSecret；保存不传 appSecret = 保留旧值。

   2) OAuth callback 的账号编排 —— 身份命中 users.feishuUnionId /
      larkUnionId / githubId → 老用户直接登录；身份未命中但 IdP 邮箱匹配任一
      已有邮箱（user_emails 主/备，其次用户名）→ 把身份绑到该账号（IdP 已
      证明邮箱归属）；都无匹配则创建 users 账号（'!oauth' 禁用密码登录）。
      随后 IdP 回传的全部邮箱登记进 user_emails（verified），并按全部邮箱 +
      手机号认领「邀请外部资源」预埋的 members 行（见
      identity.claimExternalInvites；老用户每次登录也会重试认领）。
      state nonce 校验、重定向与 session cookie 等 Web 细节留在路由层。 */

function requirePlatformAdmin(actor: Actor): void {
  if (actor.role !== 'admin') throw new ApiException('FORBIDDEN', '需要管理员权限', 403);
}

/* ========================= 提供方配置管理（平台管理员） ========================= */

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

/* ---- 全部 provider 的配置状态（含 env 兜底来源标记与回调地址推导） ---- */
export async function listOAuthProviders(actor: Actor, origin: string) {
  requirePlatformAdmin(actor);
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
  return { configSource: env.oauthConfigSource, providers: list };
}

export interface SaveOAuthProviderInput {
  provider: string;
  appId?: string;
  appSecret?: string;
  redirectUri?: string | null;
  enabled?: boolean;
}

/* ---- 保存单个 provider 配置（无行则新建；appSecret 不传 = 保留旧值） ---- */
export async function saveOAuthProvider(actor: Actor, input: SaveOAuthProviderInput) {
  requirePlatformAdmin(actor);
  const p = parseProvider(input.provider ?? '');
  if (!p) throw new ApiException('VALIDATION_FAILED', '未知的登录提供方');
  const appId = input.appId?.trim();
  if (!appId) throw new ApiException('VALIDATION_FAILED', 'App ID 不能为空');

  const [existing] = await db
    .select()
    .from(oauthProviderConfigs)
    .where(eq(oauthProviderConfigs.provider, p))
    .limit(1);
  const appSecret = input.appSecret?.trim();
  if (!existing && !appSecret) throw new ApiException('VALIDATION_FAILED', '首次保存必须填写 App Secret');
  // 验证新 secret 能加密（CONFIG_CRYPTO_KEY 缺失时这里就报错，而不是落库后读不出来）。
  const appSecretEnc = appSecret ? encryptSecret(appSecret) : existing!.appSecretEnc;
  if (appSecret) decryptSecret(appSecretEnc); // round-trip 自检

  const rawRedirect = input.redirectUri === undefined ? existing?.redirectUri : input.redirectUri?.trim() || null;
  const redirectUri = rawRedirect ? toPathOnly(rawRedirect) : rawRedirect;
  const enabled = input.enabled ?? existing?.enabled ?? true;
  const values = { appId, appSecretEnc, redirectUri, enabled, updatedAt: new Date() };
  if (existing) {
    await db.update(oauthProviderConfigs).set(values).where(eq(oauthProviderConfigs.provider, p));
  } else {
    await db.insert(oauthProviderConfigs).values({ provider: p, ...values });
  }
  invalidateOAuthConfigCache();
  return { provider: p, enabled, hasSecret: true };
}

/* ---- 删除单个 provider 的 DB 配置（回退 env 兜底） ---- */
export async function deleteOAuthProvider(actor: Actor, rawProvider: string) {
  requirePlatformAdmin(actor);
  const p = parseProvider(rawProvider);
  if (!p) throw new ApiException('VALIDATION_FAILED', '未知的登录提供方');
  await db.delete(oauthProviderConfigs).where(eq(oauthProviderConfigs.provider, p));
  invalidateOAuthConfigCache();
  return { provider: p };
}

/* ========================= OAuth callback 账号编排 ========================= */

/* 各 provider 的稳定身份存哪个字段：飞书与 Lark 分列入库（两个独立平台，
   同一自然人的 union_id 各自独立），GitHub 用数字 id。 */
function identityKey(p: OAuthProvider): 'feishuUnionId' | 'larkUnionId' | 'githubId' {
  return p === 'feishu' ? 'feishuUnionId' : p === 'lark' ? 'larkUnionId' : 'githubId';
}

function providerLabel(p: OAuthProvider): string {
  return p === 'feishu' ? '飞书' : p === 'lark' ? 'Lark' : 'GitHub';
}

/* username 优先取邮箱（可读、唯一），被占用则退化为 <provider>_<unionId前8>，
   再冲突（理论不会发生）追加随机后缀。 */
async function pickUsername(preferred: string | undefined, fallback: string): Promise<string> {
  for (const c of [preferred, fallback]) {
    if (!c) continue;
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.username, c)).limit(1);
    if (!taken) return c;
  }
  return `${fallback}_${crypto.randomUUID().slice(0, 4)}`;
}

/* 绑定模式：把 provider 身份挂到指定（当前登录的）账号上 —— 不开新账号、
   不重新登录。身份已被其他账号占用返回 'taken'。IdP 回传的邮箱逐个登记为
   verified；绑定的身份同样按全部邮箱 + 手机号认领外部邀请（邀请 = 公司希望
   此人加入的意图）。 */
export async function bindOAuthIdentity(
  userId: string,
  p: OAuthProvider,
  profile: OAuthProfile,
): Promise<'bound' | 'taken'> {
  const idKey = identityKey(p);
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users[idKey], profile.unionId))
    .limit(1);
  if (taken && taken.id !== userId) return 'taken';
  await db.update(users).set({ [idKey]: profile.unionId }).where(eq(users.id, userId));
  for (const email of profile.emails) {
    await upsertVerifiedEmail(userId, email);
  }
  if (profile.emails.length || profile.mobile) {
    await claimExternalInvites({ id: userId }, { emails: profile.emails, mobile: profile.mobile });
  }
  return 'bound';
}

/* 登录模式：把 IdP profile 解析为本地 users 行 ——
   1) 身份命中 → 老用户（name 只在首次建号时写入，之后不覆盖；仅头像跟随
      OAuth 资料刷新并同步 member 投影）；
   2) 身份未命中但 IdP 邮箱（逐个试）命中已有账号 → 把身份绑到该账号；
   3) 都无匹配 → 创建 users 账号并把昵称/头像同步到 member 投影。
   随后登记全部邮箱（verified）、按全部邮箱 + 手机号认领外部邀请（每次登录
   都重试：邀请可能晚于首次建号；认领幂等）。无标识命中则只是平台成员。
   返回 users 行；默认公司解析与 session 建立由路由完成。 */
export async function loginWithOAuthProfile(p: OAuthProvider, profile: OAuthProfile) {
  const idKey = identityKey(p);

  let [u] = await db.select().from(users).where(eq(users[idKey], profile.unionId)).limit(1);
  if (!u) {
    // 邮箱匹配：IdP 已证明这些邮箱归本人所有，命中任一已有账号（user_emails
    // 主/备优先，其次用户名恰为该邮箱）就把身份绑到该账号，而不是新建重复账号。
    for (const raw of profile.emails) {
      const email = raw.trim().toLowerCase();
      const uid = await findUserByEmail(email);
      if (uid) [u] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
      if (!u) [u] = await db.select().from(users).where(eq(users.username, email)).limit(1);
      if (u) {
        await db.update(users).set({ [idKey]: profile.unionId }).where(eq(users.id, u.id));
        console.info(`[auth/${p}] bound identity to existing user ${u.username} via email ${email}`);
        break;
      }
    }
  }
  if (!u) {
    const displayName = profile.name || `${providerLabel(p)}用户 ${profile.unionId.slice(0, 8)}`;
    const username = await pickUsername(profile.email, `${p}_${profile.unionId.slice(0, 8)}`);
    await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        username,
        name: displayName,
        passwordHash: '!oauth',
        role: 'member',
        [idKey]: profile.unionId,
        avatarUrl: profile.avatarUrl ?? null,
      })
      .onConflictDoNothing();
    [u] = await db.select().from(users).where(eq(users[idKey], profile.unionId)).limit(1);
    if (!u) throw new Error('user upsert failed');
    for (const email of profile.emails) {
      await upsertVerifiedEmail(u.id, email);
    }
    if (profile.emails.length || profile.mobile) {
      const claimed = await claimExternalInvites(u, { emails: profile.emails, mobile: profile.mobile });
      if (claimed > 0) {
        console.info(`[auth/${p}] ${u.username} claimed ${claimed} external invite(s)`);
      }
    }
    // 把 OAuth 昵称/头像同步到认领的（以及所有）member 投影行。
    await syncMemberProjection(u);
  } else {
    for (const email of profile.emails) {
      await upsertVerifiedEmail(u.id, email);
    }
    if (profile.emails.length || profile.mobile) {
      const claimed = await claimExternalInvites(u, { emails: profile.emails, mobile: profile.mobile });
      if (claimed > 0) {
        console.info(`[auth/${p}] ${u.username} claimed ${claimed} external invite(s)`);
      }
    }
    const avatarUrl = profile.avatarUrl ?? null;
    if (u.avatarUrl !== avatarUrl) {
      await db.update(users).set({ avatarUrl }).where(eq(users.id, u.id));
      await syncMemberProjection({ id: u.id, name: u.name, avatarUrl });
      u.avatarUrl = avatarUrl;
    }
  }
  return u;
}
