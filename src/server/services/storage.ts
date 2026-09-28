import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { companyStorageConfigs } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { decryptSecret, encryptSecret } from '@/server/crypto';
import {
  getPlatformStorageConfigRow,
  invalidateStorageConfigCache,
  minioConfigFromRow,
  objectKeyPrefix,
  type StorageConfigRow,
} from '@/server/storage';
import { parsePublicBaseUrl, testMinioConnection, type MinioConfig } from '@/server/storage/minio';
import { ensureCompanyProvisioning } from '@/server/storage/provision';
import type { Actor } from './types';

/* 公司附件存储配置（设置 → 文件存储 / 偏好）的业务逻辑：MinIO 后端的读取、
   保存、连通性测试与删除，以及平台 MinIO 已配置时的按公司一键开通
   （provisioned='auto'）。存储两级模型与回退规则见 @/server/storage
   （平台行 = 总开关与兜底，公司行恒优先；vercel_blob 已随 TKT-213 移除）。
   门槛：平台管理员或本公司 company_admin（与公司权限矩阵同一规则）。
   敏感字段（accessKey/secretKey）AES-256-GCM 加密落库，读取只回 hasXxx 标志
   （自动开通行额外回 account 明文 —— IAM 用户名 spms-xxx，属标识而非密钥）；
   保存时不传 = 保留旧值。
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
  token?: string; // legacy vercel_blob 字段（已移除的后端）；保留只为入参兼容，保存/测试一律拒绝
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

/* ---- 读取本公司存储配置/开通状态 ----
   无公司行:附平台侧配置/开关状态,供前端区分「平台未配置」与「平台已配置但
   本公司未开通/平台总开关关闭」。有公司行:endpoint/bucket 等字段顶层回显
   (设置→偏好的存储卡片读顶层),编辑表单用的嵌套 minio 对象与 hasXxx 标志
   保持不变,另附开通信息(mode/prefix/account/updatedAt)。 */
export async function getCompanyStorageConfig(actor: Actor) {
  requireStorageAdmin(actor);
  const row = await rowFor(actor.companyId);
  if (!row) {
    const platform = await getPlatformStorageConfigRow();
    return {
      configured: false as const,
      provisioned: false as const,
      platformConfigured: !!platform,
      platformEnabled: platform?.enabled ?? false,
    };
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
  return {
    configured: true as const,
    provisioned: true as const,
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
    endpoint: row.endpoint,
    port: row.port,
    useSsl: row.useSsl,
    bucket: row.bucket,
    publicBaseUrl: row.publicBaseUrl,
    prefix: objectKeyPrefix(actor.companyId),
    account,
    mode: row.provisioned === 'auto' ? ('auto' as const) : ('manual' as const),
    updatedAt: row.updatedAt,
  };
}

/* ---- 一键开通（设置 → 偏好的「开通存储」按钮）：平台 MinIO 已配置时，以平台
   管理员凭据为当前公司物化按前缀隔离的 IAM 账号（provisioned='auto'）。
   与平台侧 /platform/companies/:id/storage 同一物化流程，区别：只作用于当前
   公司、不支持 force（密钥轮换仍属平台管理员操作）。幂等：已有公司行（含
   手动配置行）不覆盖。 ---- */
export async function provisionCompanyStorage(actor: Actor) {
  requireStorageAdmin(actor);
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
  return {
    companyId: actor.companyId,
    provisioned: true as const,
    account,
    bucket: row.bucket,
    prefix: objectKeyPrefix(actor.companyId),
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
  // backend 枚举由 zod 层(storageConfigSaveSchema)校验；vercel_blob 已随平台
  // MinIO 化移除(TKT-213),存量调用按非法后端拒绝。
  if (input.backend !== 'minio') throw new ApiException('VALIDATION_FAILED', '仅支持 MinIO 存储后端');
  const backend = input.backend;

  const existing = await rowFor(actor.companyId);
  const existingMinio = existingMinioOf(existing);

  const conf = validatedMinio(input.minio ?? {}, existingMinio);
  const values: Partial<typeof companyStorageConfigs.$inferInsert> = {
    backend,
    endpoint: conf.endpoint,
    port: conf.port,
    useSsl: conf.useSsl,
    bucket: conf.bucket,
    publicBaseUrl: conf.publicBaseUrl,
    accessKeyEnc: encryptSecret(conf.accessKey),
    secretKeyEnc: encryptSecret(conf.secretKey),
    /* 手动保存即脱离「平台开通」语义:provisioned 置 NULL(=mode 'manual'),
       公司行从此与平台侧解耦,平台管理员再开通须 force 才会覆盖。 */
    provisioned: null,
    updatedAt: new Date(),
  };

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
  if (input.backend && input.backend !== 'minio') {
    throw new ApiException('VALIDATION_FAILED', '仅支持 MinIO 存储后端');
  }
  const existing = await rowFor(actor.companyId);

  try {
    const conf = validatedMinio(input.minio ?? {}, existingMinioOf(existing));
    await testMinioConnection(conf);
  } catch (e) {
    if (e instanceof ApiException) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new ApiException('STORAGE_TEST_FAILED', `连接失败：${msg}`, 400);
  }
  return { tested: true };
}

/* ---- 删除本公司配置（回到平台级状态：平台行在 = 未开通，都不在 = 未配置） ---- */
export async function deleteCompanyStorageConfig(actor: Actor) {
  requireStorageAdmin(actor);
  await db.delete(companyStorageConfigs).where(eq(companyStorageConfigs.companyId, actor.companyId));
  invalidateStorageConfigCache(actor.companyId);
  return { deleted: true };
}
