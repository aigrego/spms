import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { companyStorageConfigs } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { decryptSecret, encryptSecret } from '@/server/crypto';
import { invalidateStorageConfigCache, minioConfigFromRow, type StorageConfigRow } from '@/server/storage';
import { parsePublicBaseUrl, testMinioConnection, type MinioConfig } from '@/server/storage/minio';
import { testVercelConnection } from '@/server/storage/vercel';
import type { Actor } from './types';

/* 公司附件存储配置（设置 → 文件存储）的业务逻辑：MinIO / Vercel Blob 后端的
   读取、保存、连通性测试与删除。无配置行 = 禁止上传（零平台兜底）。
   门槛：平台管理员或本公司 company_admin（与公司权限矩阵同一规则）。
   敏感字段（accessKey/secretKey/token）AES-256-GCM 加密落库，读取只回
   hasXxx 标志；保存时不传 = 保留旧值。
   /api/v1/pms/storage-config 只是薄适配层。 */

function requireStorageAdmin(actor: Actor): void {
  if (!actor.isPlatformAdmin && actor.companyRole !== 'company_admin') {
    throw new ApiException('FORBIDDEN', '需要公司管理员权限', 403);
  }
}

export interface MinioConfigInput {
  endpoint?: string;
  port?: number | null;
  useSsl?: boolean;
  accessKey?: string;
  secretKey?: string;
  bucket?: string;
  /* 公网基址：不传 = 保留旧值；'' / null = 清除（回落内网 endpoint 直签）。 */
  publicBaseUrl?: string | null;
}

export interface SaveStorageConfigInput {
  backend?: string;
  minio?: MinioConfigInput;
  token?: string;
}

export type TestStorageConnectionInput = SaveStorageConfigInput & { action?: string };

async function rowFor(companyId: string): Promise<StorageConfigRow | undefined> {
  const [row] = await db
    .select()
    .from(companyStorageConfigs)
    .where(eq(companyStorageConfigs.companyId, companyId))
    .limit(1);
  return row;
}

/* 已存行的 MinIO 明文凭据；解密失败（CONFIG_CRYPTO_KEY 变更）按无存量的处理，
   让用户重填覆盖，而不是 500。 */
function existingMinioOf(row: StorageConfigRow | undefined): MinioConfig | null {
  if (!row) return null;
  try {
    return minioConfigFromRow(row);
  } catch {
    return null;
  }
}

/* 已存行的 Vercel Blob 明文 token；解密失败 → ''（要求重填）。保存与连通性
   测试共用这一段解密回落。 */
function existingTokenOf(row: StorageConfigRow | undefined): string {
  if (!row?.tokenEnc) return '';
  try {
    return decryptSecret(row.tokenEnc);
  } catch {
    return '';
  }
}

/* ---- 读取本公司存储配置（敏感字段只回 hasXxx 标志） ---- */
export async function getCompanyStorageConfig(actor: Actor) {
  requireStorageAdmin(actor);
  const row = await rowFor(actor.companyId);
  if (!row) return { configured: false as const };
  return {
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
  };
}

function validatedMinio(input: MinioConfigInput, existing: MinioConfig | null): MinioConfig {
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

/* ---- 保存配置（新建或整行替换；未传的敏感字段保留旧值），写后 bust 缓存 ---- */
export async function saveCompanyStorageConfig(actor: Actor, input: SaveStorageConfigInput) {
  requireStorageAdmin(actor);
  // backend 枚举由 zod 层(storageConfigSaveSchema)校验。
  const backend = input.backend;

  const existing = await rowFor(actor.companyId);
  const existingMinio = existingMinioOf(existing);

  const values: Partial<typeof companyStorageConfigs.$inferInsert> = {
    backend,
    updatedAt: new Date(),
  };
  if (backend === 'minio') {
    const conf = validatedMinio(input.minio ?? {}, existingMinio);
    values.endpoint = conf.endpoint;
    values.port = conf.port;
    values.useSsl = conf.useSsl;
    values.bucket = conf.bucket;
    values.publicBaseUrl = conf.publicBaseUrl;
    values.accessKeyEnc = encryptSecret(conf.accessKey);
    values.secretKeyEnc = encryptSecret(conf.secretKey);
    values.tokenEnc = null;
  } else {
    const token = input.token?.trim() || existingTokenOf(existing);
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
  return { backend };
}

/* ---- 连通性测试：用请求里的配置（缺省字段回落已存配置）做真实探测：
   bucket 存在 + 写/删探测对象。后端连接错误统一包成 STORAGE_TEST_FAILED(400)，
   ApiException（参数校验）原样抛出。 ---- */
export async function testCompanyStorageConnection(actor: Actor, input: TestStorageConnectionInput) {
  requireStorageAdmin(actor);
  // action 字面值由 zod 层(storageConfigTestSchema)校验。
  const existing = await rowFor(actor.companyId);

  try {
    if (input.backend === 'vercel_blob' || (!input.backend && existing?.backend === 'vercel_blob')) {
      const token = input.token?.trim() || existingTokenOf(existing);
      if (!token) throw new ApiException('VALIDATION_FAILED', '请填写 Blob Token');
      await testVercelConnection(token);
    } else {
      const conf = validatedMinio(input.minio ?? {}, existingMinioOf(existing));
      await testMinioConnection(conf);
    }
  } catch (e) {
    if (e instanceof ApiException) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new ApiException('STORAGE_TEST_FAILED', `连接失败：${msg}`, 400);
  }
  return { tested: true };
}

/* ---- 删除本公司配置（回到「未配置 = 禁止上传」状态） ---- */
export async function deleteCompanyStorageConfig(actor: Actor) {
  requireStorageAdmin(actor);
  await db.delete(companyStorageConfigs).where(eq(companyStorageConfigs.companyId, actor.companyId));
  invalidateStorageConfigCache(actor.companyId);
  return { deleted: true };
}
