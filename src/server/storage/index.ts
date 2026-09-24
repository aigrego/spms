import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { companyStorageConfigs, platformStorageConfigs } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { decryptSecret } from '@/server/crypto';
import { minioBackend, type MinioConfig } from './minio';
import { vercelBackend } from './vercel';
import type { StorageBackend } from './types';

export type { StorageBackend, UploadIntent } from './types';
export { assertOwnKey, companyIdFromKey, newObjectKey, objectKeyPrefix } from './types';

/* Two-level storage config: company_storage_configs wins; when a company has
   no row, fall back to the single platform_storage_configs row — vercel_blob
   falls back to the shared token directly, minio auto-provisions a
   per-company IAM user + prefix policy (provision.ts) and materializes the
   generated credentials into a company row. NO row at either level = uploads
   are forbidden. Config rows are cached 60s in-process (same pattern as the
   permissions matrix); the settings APIs bust the cache on writes. */

export type StorageConfigRow = typeof companyStorageConfigs.$inferSelect;
export type PlatformStorageConfigRow = typeof platformStorageConfigs.$inferSelect;

export const PLATFORM_STORAGE_ROW_ID = 'default';

const cache = new Map<string, { at: number; row: StorageConfigRow | null }>();
let platformCache: { at: number; row: PlatformStorageConfigRow | null } | null = null;

export function invalidateStorageConfigCache(companyId?: string) {
  if (companyId) cache.delete(companyId);
  else {
    cache.clear();
    platformCache = null;
  }
}

export function invalidatePlatformStorageConfigCache() {
  platformCache = null;
}

export async function getStorageConfigRow(companyId: string): Promise<StorageConfigRow | null> {
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at <= 60_000) return hit.row;
  const [row] = await db
    .select()
    .from(companyStorageConfigs)
    .where(eq(companyStorageConfigs.companyId, companyId))
    .limit(1);
  cache.set(companyId, { at: Date.now(), row: row ?? null });
  return row ?? null;
}

export async function getPlatformStorageConfigRow(): Promise<PlatformStorageConfigRow | null> {
  if (platformCache && Date.now() - platformCache.at <= 60_000) return platformCache.row;
  const [row] = await db
    .select()
    .from(platformStorageConfigs)
    .where(eq(platformStorageConfigs.id, PLATFORM_STORAGE_ROW_ID))
    .limit(1);
  platformCache = { at: Date.now(), row: row ?? null };
  return row ?? null;
}

/* Both config tables share the same MinIO field set. */
type MinioConfigFields = Pick<
  StorageConfigRow,
  'backend' | 'endpoint' | 'port' | 'useSsl' | 'accessKeyEnc' | 'secretKeyEnc' | 'bucket' | 'publicBaseUrl'
>;

/* Decrypted MinIO credentials from a config row (null when incomplete). */
export function minioConfigFromRow(row: MinioConfigFields): MinioConfig | null {
  if (row.backend !== 'minio') return null;
  if (!row.endpoint || !row.accessKeyEnc || !row.secretKeyEnc || !row.bucket) return null;
  return {
    endpoint: row.endpoint,
    port: row.port ?? (row.useSsl ? 443 : 9000),
    useSsl: row.useSsl,
    accessKey: decryptSecret(row.accessKeyEnc),
    secretKey: decryptSecret(row.secretKeyEnc),
    bucket: row.bucket,
    publicBaseUrl: row.publicBaseUrl,
  };
}

/* Row (company- or platform-level) → backend, decrypting credentials. */
function backendFromRow(companyId: string, row: StorageConfigRow | PlatformStorageConfigRow): StorageBackend {
  try {
    if (row.backend === 'minio') {
      const conf = minioConfigFromRow(row);
      if (!conf) throw new Error('incomplete minio config');
      /* 自动开通的隔离账号（按前缀授权）pin 死签名 region：受限凭据无
         GetBucketLocation 权限，presign 前的 region 探活会被拒并导致
         minio-js 长时间重试（表现为上传/读 URL 卡死）。 */
      if ('provisioned' in row && row.provisioned === 'auto') conf.region = 'us-east-1';
      return minioBackend(companyId, conf);
    }
    if (row.backend === 'vercel_blob') {
      if (!row.tokenEnc) throw new Error('missing vercel token');
      return vercelBackend(companyId, decryptSecret(row.tokenEnc));
    }
    throw new Error(`unknown backend ${row.backend}`);
  } catch (e) {
    if (e instanceof ApiException) throw e;
    console.error(`[storage] 公司 ${companyId} 存储配置不可用:`, e);
    throw new ApiException('STORAGE_NOT_CONFIGURED', '文件存储配置不可用（密钥解密失败或配置不完整），请重新保存配置', 400);
  }
}

/* The company's storage backend. Company config wins; otherwise fall back to
   the platform default — minio auto-provisions an isolated per-company IAM
   user (first call materializes a company row), vercel_blob reuses the shared
   platform token (app-level prefix isolation only). Throws
   STORAGE_NOT_CONFIGURED when neither level is configured. */
export async function storageForCompany(companyId: string): Promise<StorageBackend> {
  const row = await getStorageConfigRow(companyId);
  if (row) return backendFromRow(companyId, row);

  const platform = await getPlatformStorageConfigRow();
  if (!platform) {
    throw new ApiException(
      'STORAGE_NOT_CONFIGURED',
      '尚未配置文件存储，请联系公司管理员（设置 → 文件存储）或平台管理员（设置 → 平台存储）',
      400,
    );
  }
  if (platform.backend === 'minio') {
    const { ensureCompanyProvisioning } = await import('./provision');
    const materialized = await ensureCompanyProvisioning(platform, companyId);
    invalidateStorageConfigCache(companyId);
    return backendFromRow(companyId, materialized);
  }
  return backendFromRow(companyId, platform);
}
