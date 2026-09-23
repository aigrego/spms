import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { companyStorageConfigs } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { decryptSecret } from '@/server/crypto';
import { minioBackend, type MinioConfig } from './minio';
import { vercelBackend } from './vercel';
import type { StorageBackend } from './types';

export type { StorageBackend, UploadIntent } from './types';
export { assertOwnKey, companyIdFromKey, newObjectKey, objectKeyPrefix } from './types';

/* Per-company storage config (company_storage_configs). NO row = uploads are
   forbidden for the company — there is deliberately no platform-level
   fallback. Config rows are cached 60s in-process (same pattern as the
   permissions matrix); the settings API busts the entry on writes. */

export type StorageConfigRow = typeof companyStorageConfigs.$inferSelect;

const cache = new Map<string, { at: number; row: StorageConfigRow | null }>();

export function invalidateStorageConfigCache(companyId?: string) {
  if (companyId) cache.delete(companyId);
  else cache.clear();
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

/* Decrypted MinIO credentials from a config row (null when incomplete). */
export function minioConfigFromRow(row: StorageConfigRow): MinioConfig | null {
  if (row.backend !== 'minio') return null;
  if (!row.endpoint || !row.accessKeyEnc || !row.secretKeyEnc || !row.bucket) return null;
  return {
    endpoint: row.endpoint,
    port: row.port ?? (row.useSsl ? 443 : 9000),
    useSsl: row.useSsl,
    accessKey: decryptSecret(row.accessKeyEnc),
    secretKey: decryptSecret(row.secretKeyEnc),
    bucket: row.bucket,
  };
}

/* The company's storage backend. Throws STORAGE_NOT_CONFIGURED when the
   company has no (complete) config row — upload entry points surface this as
   an explicit "configure storage first" error. */
export async function storageForCompany(companyId: string): Promise<StorageBackend> {
  const row = await getStorageConfigRow(companyId);
  if (!row) {
    throw new ApiException('STORAGE_NOT_CONFIGURED', '本公司尚未配置文件存储，请联系公司管理员（设置 → 文件存储）', 400);
  }
  try {
    if (row.backend === 'minio') {
      const conf = minioConfigFromRow(row);
      if (!conf) throw new Error('incomplete minio config');
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
