import { ok } from '@/lib/envelope';
import { requireActor, route } from '@/server/http';
import {
  deleteCompanyStorageConfig,
  getCompanyStorageConfig,
  provisionCompanyStorage,
  saveCompanyStorageConfig,
  testCompanyStorageConnection,
} from '@/server/services/storage';
import { jsonBodyWith, storageConfigSaveSchema, storageConfigTestSchema } from '@/server/validate';

/* /api/v1/pms/storage-config — 公司管理员管理本公司的附件存储（设置 → 文件存储
   / 偏好）。存储两级模型与回退规则见 @/server/storage（平台行 = 总开关与兜底，
   公司行恒优先）；一键开通的物化流程见 @/server/storage/provision。
   GET    配置/开通状态：无公司行时附平台侧配置/开关状态，供前端区分
          「平台未配置」与「平台已配置但本公司未开通/平台总开关关闭」；
   PUT    保存手动 MinIO 配置（覆盖自动开通行；未传的敏感字段保留旧值）；
   POST   无 body 或 {action:'provision'} → 一键开通（平台 MinIO 已配置时物化
          本公司按前缀隔离的 IAM 账号，幂等，已有公司行不覆盖）；
          {action:'test', minio?} → 连通性测试（缺省字段回落已存配置）；
   DELETE 删除本公司配置（回到平台级状态）。
   薄路由：权限门槛、加解密、缓存失效与 provisioning 全部业务逻辑见
   @/server/services/storage。 */

export const GET = route(async () => ok(await getCompanyStorageConfig(await requireActor())));

export const PUT = route(async (req) =>
  ok(await saveCompanyStorageConfig(await requireActor(), await jsonBodyWith(req, storageConfigSaveSchema))),
);

export const POST = route(async (req) => {
  const actor = await requireActor();
  /* action 分流：体为空（设置→偏好「开通存储」按钮的存量调用）或显式
     {action:'provision'} → 一键开通；否则按 storageConfigTestSchema 走连通性
     测试（jsonBodyWith 读原始请求体，错误格式与其他写端点一致）。 */
  const peek = await req.clone().text();
  if (!peek.trim()) return ok(await provisionCompanyStorage(actor));
  let probe: { action?: unknown } | null = null;
  try {
    probe = JSON.parse(peek) as { action?: unknown };
  } catch {
    probe = null; // 非 JSON：交给 jsonBodyWith 抛统一的「请求体不是合法 JSON」
  }
  if (probe?.action === 'provision') return ok(await provisionCompanyStorage(actor));
  return ok(await testCompanyStorageConnection(actor, await jsonBodyWith(req, storageConfigTestSchema)));
});

export const DELETE = route(async () => ok(await deleteCompanyStorageConfig(await requireActor())));
