import { ok } from '@/lib/envelope';
import { jsonBody, requireActor, route } from '@/server/http';
import {
  deleteCompanyStorageConfig,
  getCompanyStorageConfig,
  saveCompanyStorageConfig,
  testCompanyStorageConnection,
  type SaveStorageConfigInput,
  type TestStorageConnectionInput,
} from '@/server/services/storage';

/* /api/v1/pms/storage-config — 公司管理员在 设置→文件存储 管理本公司的附件
   存储后端(MinIO / Vercel Blob)。无配置行 = 禁止上传(零平台兜底)。
   薄路由：权限门槛、校验、加解密落库与缓存失效等全部业务逻辑见
   @/server/services/storage。 */

export const GET = route(async () => ok(await getCompanyStorageConfig(await requireActor())));

export const PUT = route(async (req) =>
  ok(await saveCompanyStorageConfig(await requireActor(), await jsonBody<SaveStorageConfigInput>(req))),
);

/* POST { action:'test', minio?, token? } — 用请求里的配置(缺省字段回落已存
   配置)做真实连通性测试:bucket 存在 + 写/删探测对象。 */
export const POST = route(async (req) =>
  ok(await testCompanyStorageConnection(await requireActor(), await jsonBody<TestStorageConnectionInput>(req))),
);

export const DELETE = route(async () => ok(await deleteCompanyStorageConfig(await requireActor())));
