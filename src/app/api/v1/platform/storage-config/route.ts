import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { platformStorageConfigs } from '@/db/schema';
import { ApiException, ok } from '@/lib/envelope';
import { encryptSecret } from '@/server/crypto';
import { jsonBody, requireActor, requireAdmin, route } from '@/server/http';
import {
  invalidatePlatformStorageConfigCache,
  minioConfigFromRow,
  PLATFORM_STORAGE_ROW_ID,
} from '@/server/storage';
import { parsePublicBaseUrl, type MinioConfig } from '@/server/storage/minio';
import { verifyPlatformMinioAccess } from '@/server/storage/provision';

/* /api/v1/platform/storage-config — 平台管理员在 设置→平台存储 管理全局默认
   附件存储后端（仅 MinIO）。enabled 是平台级总开关：false 时全平台存储读写
   全禁（STORAGE_DISABLED），可单独 PUT { enabled } 部分更新。公司存储行不由
   这里回落共用，而是由平台管理员在 公司管理 手动「开通存储」物化（按前缀隔离
   的独立 IAM 用户）——因此这里的 MinIO 凭据必须有管理员权限(root 或
   consoleAdmin 用户)。门槛:仅平台管理员。
   敏感字段 AES-256-GCM 加密落库,GET 只回 hasXxx 标志;PUT 不传 = 保留旧值。 */

interface MinioInput {
  endpoint?: string;
  port?: number | null;
  useSsl?: boolean;
  accessKey?: string;
  secretKey?: string;
  bucket?: string;
  /* 公网基址：不传 = 保留旧值；'' / null = 清除（回落内网 endpoint 直签）。 */
  publicBaseUrl?: string | null;
}

/* 已存行的 MinIO 明文凭据;解密失败(CONFIG_CRYPTO_KEY 变更)按无存量的处理,
   让用户重填覆盖,而不是 500。 */
function existingMinioOf(row: typeof platformStorageConfigs.$inferSelect | undefined): MinioConfig | null {
  if (!row) return null;
  try {
    return minioConfigFromRow(row);
  } catch {
    return null;
  }
}

interface PutBody {
  backend?: string; // 缺省视为 'minio'
  minio?: MinioInput;
  /* 平台总开关：不传 = 保留旧值（无存量的新行落默认 true）。 */
  enabled?: boolean;
}

async function existingRow() {
  const [row] = await db
    .select()
    .from(platformStorageConfigs)
    .where(eq(platformStorageConfigs.id, PLATFORM_STORAGE_ROW_ID))
    .limit(1);
  return row;
}

export const GET = route(async () => {
  const actor = await requireActor();
  requireAdmin(actor);
  const row = await existingRow();
  if (!row) return ok({ configured: false as const });
  return ok({
    configured: true as const,
    backend: row.backend,
    enabled: row.enabled,
    minio:
      row.backend === 'minio'
        ? {
            endpoint: row.endpoint,
            port: row.port,
            useSsl: row.useSsl,
            bucket: row.bucket,
            publicBaseUrl: row.publicBaseUrl,
            hasAccessKey: !!row.accessKeyEnc,
            hasSecretKey: !!row.secretKeyEnc,
          }
        : null,
  });
});

function validatedMinio(input: MinioInput, existing: MinioConfig | null): MinioConfig {
  const endpoint = (input.endpoint ?? existing?.endpoint)?.trim();
  const bucket = (input.bucket ?? existing?.bucket)?.trim();
  const accessKey = input.accessKey?.trim() || existing?.accessKey;
  const secretKey = input.secretKey?.trim() || existing?.secretKey;
  const useSsl = input.useSsl ?? existing?.useSsl ?? true;
  const port = input.port ?? existing?.port ?? (useSsl ? 443 : 9000);
  /* 公网基址：undefined 保留旧值；'' / null 清除；其余校验并规范化落库。 */
  const publicBaseUrl =
    input.publicBaseUrl === undefined
      ? (existing?.publicBaseUrl ?? null)
      : input.publicBaseUrl?.trim()
        ? parsePublicBaseUrl(input.publicBaseUrl).base
        : null;
  if (!endpoint) throw new ApiException('VALIDATION_FAILED', 'Endpoint 不能为空');
  if (!Number.isInteger(port) || port! < 1 || port! > 65535) {
    throw new ApiException('VALIDATION_FAILED', '端口非法');
  }
  if (!bucket) throw new ApiException('VALIDATION_FAILED', 'Bucket 不能为空');
  if (!accessKey || !secretKey) {
    throw new ApiException('VALIDATION_FAILED', '首次保存必须填写 Access Key 与 Secret Key（需管理员权限凭据）');
  }
  return { endpoint: endpoint!, port: port!, useSsl, accessKey, secretKey, bucket: bucket!, publicBaseUrl };
}

export const PUT = route(async (req) => {
  const actor = await requireActor();
  requireAdmin(actor);
  const body = await jsonBody<PutBody>(req);
  const backend = body.backend ?? 'minio';
  if (backend !== 'minio') {
    throw new ApiException('VALIDATION_FAILED', 'backend 只支持 minio');
  }

  const existing = await existingRow();
  const existingMinio = existingMinioOf(existing);

  /* minio 字段「不传 = 保留旧值」；只 PUT { enabled }（总开关切换）时其余
     字段原样回落,等价于一次无副作用的部分更新。 */
  const conf = validatedMinio(body.minio ?? {}, existingMinio);
  const values: Partial<typeof platformStorageConfigs.$inferInsert> = {
    backend,
    enabled: body.enabled ?? existing?.enabled ?? true,
    endpoint: conf.endpoint,
    port: conf.port,
    useSsl: conf.useSsl,
    bucket: conf.bucket,
    publicBaseUrl: conf.publicBaseUrl,
    accessKeyEnc: encryptSecret(conf.accessKey),
    secretKeyEnc: encryptSecret(conf.secretKey),
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(platformStorageConfigs).set(values).where(eq(platformStorageConfigs.id, PLATFORM_STORAGE_ROW_ID));
  } else {
    await db
      .insert(platformStorageConfigs)
      .values({ id: PLATFORM_STORAGE_ROW_ID, ...values } as typeof platformStorageConfigs.$inferInsert);
  }
  invalidatePlatformStorageConfigCache();
  return ok({ backend, enabled: values.enabled! });
});

/* POST { action:'test', minio? } — 用请求里的配置(缺省字段回落已存配置)做
   真实连通性测试。除 bucket 存在/创建 + 写删探测外,额外校验管理员能力
   (mc admin user list),因为手动「开通存储」依赖 admin 权限。 */
export const POST = route(async (req) => {
  const actor = await requireActor();
  requireAdmin(actor);
  const body = await jsonBody<PutBody & { action?: string }>(req);
  if (body.action !== 'test') throw new ApiException('VALIDATION_FAILED', '未知 action');
  const existing = await existingRow();

  try {
    const conf = validatedMinio(body.minio ?? {}, existingMinioOf(existing));
    await verifyPlatformMinioAccess(conf);
  } catch (e) {
    if (e instanceof ApiException) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new ApiException('STORAGE_TEST_FAILED', `连接失败：${msg}`, 400);
  }
  return ok({ tested: true });
});

export const DELETE = route(async () => {
  const actor = await requireActor();
  requireAdmin(actor);
  await db.delete(platformStorageConfigs).where(eq(platformStorageConfigs.id, PLATFORM_STORAGE_ROW_ID));
  invalidatePlatformStorageConfigCache();
  return ok({ deleted: true });
});
