import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { companyStorageConfigs } from '@/db/schema';
import { ApiException, ok } from '@/lib/envelope';
import { decryptSecret, encryptSecret } from '@/server/crypto';
import { jsonBody, requireActor, route } from '@/server/http';
import { invalidateStorageConfigCache, minioConfigFromRow } from '@/server/storage';
import { parsePublicBaseUrl, testMinioConnection, type MinioConfig } from '@/server/storage/minio';
import { testVercelConnection } from '@/server/storage/vercel';

/* /api/v1/pms/storage-config — 公司管理员在 设置→文件存储 管理本公司的附件
   存储后端(MinIO / Vercel Blob)。无配置行 = 禁止上传(零平台兜底)。
   门槛:平台管理员或本公司 company_admin(与公司权限矩阵同一规则)。
   敏感字段(accessKey/secretKey/token)AES-256-GCM 加密落库,GET 只回
   hasXxx 标志;PUT 不传 = 保留旧值。 */

function gate(actor: { isPlatformAdmin: boolean; companyRole: string }) {
  if (!actor.isPlatformAdmin && actor.companyRole !== 'company_admin') {
    throw new ApiException('FORBIDDEN', '需要公司管理员权限', 403);
  }
}

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
function existingMinioOf(row: typeof companyStorageConfigs.$inferSelect | undefined): MinioConfig | null {
  if (!row) return null;
  try {
    return minioConfigFromRow(row);
  } catch {
    return null;
  }
}

interface PutBody {
  backend?: string;
  minio?: MinioInput;
  token?: string;
}

export const GET = route(async () => {
  const actor = await requireActor();
  gate(actor);
  const [row] = await db
    .select()
    .from(companyStorageConfigs)
    .where(eq(companyStorageConfigs.companyId, actor.companyId))
    .limit(1);
  if (!row) return ok({ configured: false as const });
  return ok({
    configured: true as const,
    backend: row.backend,
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
    hasToken: !!row.tokenEnc,
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
    throw new ApiException('VALIDATION_FAILED', '首次保存必须填写 Access Key 与 Secret Key');
  }
  return { endpoint: endpoint!, port: port!, useSsl, accessKey, secretKey, bucket: bucket!, publicBaseUrl };
}

export const PUT = route(async (req) => {
  const actor = await requireActor();
  gate(actor);
  const body = await jsonBody<PutBody>(req);
  const backend = body.backend;
  if (backend !== 'minio' && backend !== 'vercel_blob') {
    throw new ApiException('VALIDATION_FAILED', 'backend 必须是 minio 或 vercel_blob');
  }

  const [existing] = await db
    .select()
    .from(companyStorageConfigs)
    .where(eq(companyStorageConfigs.companyId, actor.companyId))
    .limit(1);
  const existingMinio = existingMinioOf(existing);

  const values: Partial<typeof companyStorageConfigs.$inferInsert> = {
    backend,
    updatedAt: new Date(),
  };
  if (backend === 'minio') {
    const conf = validatedMinio(body.minio ?? {}, existingMinio);
    values.endpoint = conf.endpoint;
    values.port = conf.port;
    values.useSsl = conf.useSsl;
    values.bucket = conf.bucket;
    values.publicBaseUrl = conf.publicBaseUrl;
    values.accessKeyEnc = encryptSecret(conf.accessKey);
    values.secretKeyEnc = encryptSecret(conf.secretKey);
    values.tokenEnc = null;
  } else {
    let existingToken = '';
    if (existing?.tokenEnc) {
      try {
        existingToken = decryptSecret(existing.tokenEnc);
      } catch {
        existingToken = ''; // 解密失败 → 要求重填
      }
    }
    const token = body.token?.trim() || existingToken;
    if (!token) throw new ApiException('VALIDATION_FAILED', '首次保存必须填写 Blob Token');
    values.tokenEnc = encryptSecret(token);
    values.endpoint = values.port = values.accessKeyEnc = values.secretKeyEnc = values.bucket = values.publicBaseUrl = null;
  }

  if (existing) {
    await db.update(companyStorageConfigs).set(values).where(eq(companyStorageConfigs.companyId, actor.companyId));
  } else {
    await db.insert(companyStorageConfigs).values({ companyId: actor.companyId, ...values } as typeof companyStorageConfigs.$inferInsert);
  }
  invalidateStorageConfigCache(actor.companyId);
  return ok({ backend });
});

/* POST { action:'test', minio?, token? } — 用请求里的配置(缺省字段回落已存
   配置)做真实连通性测试:bucket 存在 + 写/删探测对象。 */
export const POST = route(async (req) => {
  const actor = await requireActor();
  gate(actor);
  const body = await jsonBody<PutBody & { action?: string }>(req);
  if (body.action !== 'test') throw new ApiException('VALIDATION_FAILED', '未知 action');
  const [existing] = await db
    .select()
    .from(companyStorageConfigs)
    .where(eq(companyStorageConfigs.companyId, actor.companyId))
    .limit(1);

  try {
    if (body.backend === 'vercel_blob' || (!body.backend && existing?.backend === 'vercel_blob')) {
      let existingToken = '';
      if (existing?.tokenEnc) {
        try {
          existingToken = decryptSecret(existing.tokenEnc);
        } catch {
          existingToken = '';
        }
      }
      const token = body.token?.trim() || existingToken;
      if (!token) throw new ApiException('VALIDATION_FAILED', '请填写 Blob Token');
      await testVercelConnection(token);
    } else {
      const conf = validatedMinio(body.minio ?? {}, existingMinioOf(existing));
      await testMinioConnection(conf);
    }
  } catch (e) {
    if (e instanceof ApiException) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new ApiException('STORAGE_TEST_FAILED', `连接失败：${msg}`, 400);
  }
  return ok({ tested: true });
});

export const DELETE = route(async () => {
  const actor = await requireActor();
  gate(actor);
  await db.delete(companyStorageConfigs).where(eq(companyStorageConfigs.companyId, actor.companyId));
  invalidateStorageConfigCache(actor.companyId);
  return ok({ deleted: true });
});
