import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { companyStorageConfigs, platformStorageConfigs } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { decryptSecret } from '@/server/crypto';
import { minioBackend, type MinioConfig } from './minio';
import type { StorageBackend } from './types';

export type { AttachmentCategory, KeyingSegments, StorageBackend, UploadIntent } from './types';
export { ATTACHMENT_CATEGORIES, assertOwnKey, categoryFromKey, companyIdFromKey, newObjectKey, objectKeyPrefix } from './types';

/* Two-level storage config: the single platform_storage_configs row is the
   platform-level MinIO backend and the master switch — `enabled=false`
   forbids all storage reads/writes. A company_storage_configs row (manual
   config, or `provisioned='auto'` materialized by the platform admin's
   manual 开通存储 action — see provision.ts) gives the company its own
   backend. A company with no row while the platform row exists is NOT
   provisioned (STORAGE_NOT_PROVISIONED); no row at either level =
   STORAGE_NOT_CONFIGURED. Config rows are cached 60s in-process (same
   pattern as the permissions matrix); the settings APIs bust the cache on
   writes. */

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
    throw new Error(`unknown backend ${row.backend}`);
  } catch (e) {
    if (e instanceof ApiException) throw e;
    console.error(`[storage] 公司 ${companyId} 存储配置不可用:`, e);
    throw new ApiException('STORAGE_NOT_CONFIGURED', '文件存储配置不可用（密钥解密失败或配置不完整），请重新保存配置', 400);
  }
}

/* The company's storage backend — the single choke point all storage access
   flows through (object read proxy, upload signing, MCP, Notion sync), so the
   platform kill switch and the provisioning gate both live here:

     1. platform row exists and `enabled=false` → STORAGE_DISABLED (读写全禁);
     2. company row exists → use it (manual config wins; `provisioned='auto'`
        rows keep working, pinned to region us-east-1);
     3. no company row, no platform row → STORAGE_NOT_CONFIGURED;
     4. no company row, platform row present → STORAGE_NOT_PROVISIONED.

   There is NO lazy provisioning here: opening storage for a company is a
   manual platform-admin action (设置 → 公司管理 → 开通存储) which calls
   ensureCompanyProvisioning() in provision.ts directly. */
export async function storageForCompany(companyId: string): Promise<StorageBackend> {
  const platform = await getPlatformStorageConfigRow();
  if (platform && !platform.enabled) {
    throw new ApiException('STORAGE_DISABLED', '平台文件存储已停用，请联系平台管理员', 400);
  }

  const row = await getStorageConfigRow(companyId);
  if (row) return backendFromRow(companyId, row);

  if (!platform) {
    throw new ApiException('STORAGE_NOT_CONFIGURED', '尚未配置文件存储，请联系平台管理员（设置 → 平台存储）', 400);
  }
  throw new ApiException(
    'STORAGE_NOT_PROVISIONED',
    '本公司尚未开通文件存储，请联系平台管理员（设置 → 公司管理 → 开通存储）',
    400,
  );
}
