import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import * as Minio from 'minio';
import { db } from '@/db';
import { companyStorageConfigs } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { encryptSecret } from '@/server/crypto';
import { minioConfigFromRow, type PlatformStorageConfigRow, type StorageConfigRow } from './index';
import { withMcAdmin } from './mc';
import { probePrefixAccess, testMinioConnection, type MinioConfig } from './minio';
import { objectKeyPrefix } from './types';

/* Auto-provisioning of per-company MinIO isolation (shared-bucket model):
   when a company has no storage config row and the platform default is MinIO,
   the first upload creates
     1. a canned policy `spms-co-<cid>` allowing S3 ops only under the
        company's key prefix `issues/{companyId}/` in the shared bucket,
     2. an IAM user `spms-<cid>` with a random secret, policy attached,
   then materializes those restricted credentials (AES-256-GCM) into
   company_storage_configs (provisioned='auto'). From then on the company row
   is independent — a company admin can replace it with their own backend at
   any time (company-level always wins). MinIO enforces the isolation
   server-side: company A's key cannot read company B's objects. */

const cid8 = (companyId: string) => companyId.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 8) || 'company';

export const provisionUserName = (companyId: string) => `spms-${cid8(companyId)}`;
export const provisionPolicyName = (companyId: string) => `spms-co-${cid8(companyId)}`;

/* Prefix-scoped canned policy for one company (S3 policy JSON). */
export function companyPolicyDocument(bucket: string, companyId: string): string {
  const prefix = objectKeyPrefix(companyId);
  return JSON.stringify(
    {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'SpmsCompanyObjects',
          Effect: 'Allow',
          Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:AbortMultipartUpload', 's3:ListMultipartUploadParts'],
          Resource: [`arn:aws:s3:::${bucket}/${prefix}*`],
        },
        {
          Sid: 'SpmsCompanyList',
          Effect: 'Allow',
          Action: ['s3:ListBucket'],
          Resource: [`arn:aws:s3:::${bucket}`],
          Condition: { StringLike: { 's3:prefix': [`${prefix}*`] } },
        },
      ],
    },
    null,
    2,
  );
}

/* In-process per-company mutex — the common concurrent case (two uploads
   landing together) collapses onto one provisioning run. Cross-process races
   converge because `mc admin user add` last-writer-wins and only the process
   whose credentials survive the prefix probe persists the row. */
const inflight = new Map<string, Promise<StorageConfigRow>>();

export function ensureCompanyProvisioning(
  platform: PlatformStorageConfigRow,
  companyId: string,
): Promise<StorageConfigRow> {
  const pending = inflight.get(companyId);
  if (pending) return pending;
  const run = doEnsure(platform, companyId).finally(() => inflight.delete(companyId));
  inflight.set(companyId, run);
  return run;
}

async function doEnsure(platform: PlatformStorageConfigRow, companyId: string): Promise<StorageConfigRow> {
  const [existing] = await db
    .select()
    .from(companyStorageConfigs)
    .where(eq(companyStorageConfigs.companyId, companyId))
    .limit(1);
  if (existing) return existing;

  const admin = minioConfigFromRow(platform);
  if (!admin) {
    throw new ApiException('STORAGE_PROVISION_FAILED', '平台 MinIO 配置不完整，请联系平台管理员（设置 → 平台存储）', 400);
  }

  const user = provisionUserName(companyId);
  const policy = provisionPolicyName(companyId);
  const secretKey = randomBytes(20).toString('base64url');

  try {
    await withMcAdmin(admin, async (alias, run, configDir) => {
      await run(['mb', `${alias}/${admin.bucket}`, '--ignore-existing']);
      const policyFile = join(configDir, 'policy.json');
      await writeFile(policyFile, companyPolicyDocument(admin.bucket, companyId));
      await run(['admin', 'policy', 'create', alias, policy, policyFile]);
      await run(['admin', 'user', 'add', alias, user, secretKey]);
      await run(['admin', 'policy', 'attach', alias, policy, '--user', user]);
    });
    /* 自动开通的受限凭据在生产路径上按 pin 死的 us-east-1 签发（见
       MinioConfig.region）：平台 MinIO 若用非默认 region，签名必错——
       用管理员凭据探真实 region，非默认就明确报错（引导改用公司级手动
       配置），而不是留下一个必挂的物化行。 */
    const adminClient = new Minio.Client({
      endPoint: admin.endpoint,
      port: admin.port,
      useSSL: admin.useSsl,
      accessKey: admin.accessKey,
      secretKey: admin.secretKey,
    });
    const region = await adminClient.getBucketRegionAsync(admin.bucket).catch(() => 'us-east-1');
    if (region !== 'us-east-1') {
      throw new Error(`平台 MinIO 使用非默认 region（${region}），自动开通仅支持默认 region；请改用公司级手动配置`);
    }
    /* End-to-end validation with the RESTRICTED credentials: put/del a probe
       object under the company's prefix. Only after this succeeds are the
       credentials persisted — a lost race (secret overwritten by another
       process) fails here and leaves no stale row behind. */
    await probePrefixAccess({ ...admin, accessKey: user, secretKey, region }, objectKeyPrefix(companyId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[storage] 公司 ${companyId} 自动开通失败:`, msg);
    throw new ApiException('STORAGE_PROVISION_FAILED', `平台存储自动开通失败：${msg}`, 400);
  }

  const values = {
    backend: 'minio' as const,
    endpoint: platform.endpoint,
    port: platform.port,
    useSsl: platform.useSsl,
    accessKeyEnc: encryptSecret(user),
    secretKeyEnc: encryptSecret(secretKey),
    bucket: platform.bucket,
    publicBaseUrl: platform.publicBaseUrl,
    tokenEnc: null,
    provisioned: 'auto' as const,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(companyStorageConfigs)
    .values({ companyId, ...values })
    .onConflictDoUpdate({ target: companyStorageConfigs.companyId, set: values })
    .returning();
  return row;
}

/* 设置页（平台存储）「测试连接」：bucket 不存在则创建 → 根目录写删探测 →
   验证凭据具备 MinIO 管理员权限（建用户/策略属于 admin 操作，普通 S3 用户
   无权，自动开通会在首次上传时失败）。 */
export async function verifyPlatformMinioAccess(conf: MinioConfig): Promise<void> {
  const client = new Minio.Client({
    endPoint: conf.endpoint,
    port: conf.port,
    useSSL: conf.useSsl,
    accessKey: conf.accessKey,
    secretKey: conf.secretKey,
  });
  if (!(await client.bucketExists(conf.bucket))) {
    await client.makeBucket(conf.bucket);
  }
  await testMinioConnection(conf);
  try {
    await withMcAdmin(conf, async (alias, run) => {
      await run(['admin', 'user', 'list', alias]);
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ApiException(
      'VALIDATION_FAILED',
      `S3 连接正常，但管理员能力校验失败（自动开通公司隔离账号需要管理员权限凭据，如 root 或 consoleAdmin 用户）：${msg}`,
    );
  }
}
