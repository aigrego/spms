import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { companyStorageConfigs } from '@/db/schema';
import { ApiException, ok } from '@/lib/envelope';
import { decryptSecret } from '@/server/crypto';
import { requireActor, route } from '@/server/http';
import { getPlatformStorageConfigRow, invalidateStorageConfigCache, objectKeyPrefix } from '@/server/storage';
import { ensureCompanyProvisioning } from '@/server/storage/provision';

/* /api/v1/pms/storage-config — 本公司存储状态（设置→偏好）。
   GET 只读:无公司行时返回平台侧的配置/开关状态，供前端区分「平台未配置」
   与「平台已配置但本公司未开通/平台总开关关闭」。
   POST 一键开通:平台存储已配置时，以平台 MinIO 管理员凭据为当前公司物化
   按前缀隔离的 IAM 账号（provisioned='auto'）；默认幂等，已有公司行（含
   手动配置行）不覆盖。密钥轮换（force）仍由平台管理员在 公司管理 操作。
   历史手动配置行（provisioned IS NULL）继续生效（mode='manual'）。
   门槛:平台管理员或本公司 company_admin(与公司权限矩阵同一规则)。
   accessKeyEnc 解密后作为 account 回显（自动开通行里就是 IAM 用户名
   spms-xxx，属标识而非密钥）；secretKey 永不回显。 */

function gate(actor: { isPlatformAdmin: boolean; companyRole: string }) {
  if (!actor.isPlatformAdmin && actor.companyRole !== 'company_admin') {
    throw new ApiException('FORBIDDEN', '需要公司管理员权限', 403);
  }
}

export const GET = route(async () => {
  const actor = await requireActor();
  gate(actor);
  const [row] = await db
    .select()
    .from(companyStorageConfigs)
    .where(eq(companyStorageConfigs.companyId, actor.companyId))
    .limit(1);
  if (!row) {
    /* 无公司行 → 未开通；带上平台侧状态供前端区分「平台未配置」与
       「平台已配置但本公司未开通/平台总开关关闭」。 */
    const platform = await getPlatformStorageConfigRow();
    return ok({
      provisioned: false as const,
      platformConfigured: !!platform,
      platformEnabled: platform?.enabled ?? false,
    });
  }
  /* account = 解密 accessKeyEnc（auto 行即 IAM 用户名 spms-xxx）；
     解密失败（CONFIG_CRYPTO_KEY 变更）回退 null，不 500。 */
  let account: string | null = null;
  if (row.accessKeyEnc) {
    try {
      account = decryptSecret(row.accessKeyEnc);
    } catch {
      account = null;
    }
  }
  return ok({
    provisioned: true as const,
    backend: 'minio' as const,
    endpoint: row.endpoint,
    port: row.port,
    useSsl: row.useSsl,
    bucket: row.bucket,
    publicBaseUrl: row.publicBaseUrl,
    prefix: objectKeyPrefix(actor.companyId),
    account,
    mode: row.provisioned ?? 'manual',
    updatedAt: row.updatedAt,
  });
});

/* POST — 为当前公司一键开通存储（设置→偏好的「开通存储」按钮）。与平台侧
   /platform/companies/:id/storage 同一物化流程，区别:只作用于当前公司、
   不支持 force（密钥轮换仍属平台管理员操作）。 */
export const POST = route(async () => {
  const actor = await requireActor();
  gate(actor);

  const platform = await getPlatformStorageConfigRow();
  if (!platform || platform.backend !== 'minio') {
    throw new ApiException('STORAGE_NOT_CONFIGURED', '请先在 设置 → 平台存储 配置平台 MinIO 存储', 400);
  }

  const row = await ensureCompanyProvisioning(platform, actor.companyId);
  invalidateStorageConfigCache(actor.companyId);

  let account: string | null = null;
  if (row.accessKeyEnc) {
    try {
      account = decryptSecret(row.accessKeyEnc);
    } catch {
      account = null;
    }
  }
  return ok({
    companyId: actor.companyId,
    provisioned: true as const,
    account,
    bucket: row.bucket,
    prefix: objectKeyPrefix(actor.companyId),
  });
});
