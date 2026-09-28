import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { companies } from '@/db/schema';
import { ApiException, ok } from '@/lib/envelope';
import { decryptSecret } from '@/server/crypto';
import { requireActor, requireAdmin, route } from '@/server/http';
import { getPlatformStorageConfigRow, invalidateStorageConfigCache, objectKeyPrefix } from '@/server/storage';
import { ensureCompanyProvisioning } from '@/server/storage/provision';

type Ctx = { params: Promise<{ id: string }> };

/* POST /api/v1/platform/companies/:id/storage — 平台管理员手动为该公司开通
   存储：以平台 MinIO 管理员凭据创建按前缀隔离的 IAM 用户并物化
   company_storage_configs 行（provisioned='auto'）。body { force?: boolean }
   （body 可整体省略）：默认幂等——已有公司行（含手动配置行）直接返回不
   覆盖；force=true 重跑开通流程并覆盖行（mc admin user add 覆盖密钥 =
   密钥轮换）。失败透传 STORAGE_PROVISION_FAILED。Platform admin only. */
export const POST = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  requireAdmin(actor);
  const companyId = (await ctx.params).id;
  /* body 可省略（空 body 视为 {}）；非法 JSON 也按默认幂等处理。 */
  const body = (await req.json().catch(() => ({}))) as { force?: boolean };

  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) throw new ApiException('NOT_FOUND', '公司不存在');

  const platform = await getPlatformStorageConfigRow();
  if (!platform || platform.backend !== 'minio') {
    throw new ApiException('STORAGE_NOT_CONFIGURED', '请先在 设置 → 平台存储 配置平台 MinIO 存储', 400);
  }

  const row = await ensureCompanyProvisioning(platform, companyId, { force: body.force === true });
  invalidateStorageConfigCache(companyId);

  /* account = 该行 accessKeyEnc 的明文（auto 行即 IAM 用户名 spms-xxx）；
     解密失败回退 null，不影响开通结果本身。 */
  let account: string | null = null;
  if (row.accessKeyEnc) {
    try {
      account = decryptSecret(row.accessKeyEnc);
    } catch {
      account = null;
    }
  }
  return ok({ companyId, provisioned: true as const, account, bucket: row.bucket, prefix: objectKeyPrefix(companyId) });
});
