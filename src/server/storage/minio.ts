import * as Minio from 'minio';
import { ApiException } from '@/lib/envelope';
import { assertOwnKey, newObjectKey, type StorageBackend, type UploadIntent } from './types';

/* MinIO (S3-compatible) backend. The bucket is expected to be PRIVATE — all
   reads go through the app's /attachments/object proxy, which 302s to a
   short-lived presigned GET after enforcing company isolation. Browser
   uploads use presigned PUT URLs (the bucket needs a CORS rule allowing PUT
   from the app's origin). */

export interface MinioConfig {
  endpoint: string;
  port: number;
  useSsl: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

const PUT_EXPIRY_S = 10 * 60; // 浏览器 10 分钟内完成直传
const GET_EXPIRY_S = 5 * 60; // 代理 302 后立即跟随，短时效即可

export function minioBackend(companyId: string, conf: MinioConfig): StorageBackend {
  const client = new Minio.Client({
    endPoint: conf.endpoint,
    port: conf.port,
    useSSL: conf.useSsl,
    accessKey: conf.accessKey,
    secretKey: conf.secretKey,
  });

  /* 规范 url：仅作为身份标识存入 DB 并通过 assertMeta 校验 —— bucket 是私有的,
     该 url 公网不可读,真正的读取走代理路由。 */
  const canonicalUrl = (key: string) =>
    `${conf.useSsl ? 'https' : 'http'}://${conf.endpoint}:${conf.port}/${conf.bucket}/${key}`;

  return {
    kind: 'minio',
    companyId,

    async createUploadIntent(filename: string): Promise<UploadIntent> {
      const objectKey = newObjectKey(companyId, filename);
      const uploadUrl = await client.presignedPutObject(conf.bucket, objectKey, PUT_EXPIRY_S);
      return { mode: 'presigned-put', uploadUrl, objectKey };
    },

    async put(objectKey, body, contentType) {
      assertOwnKey(companyId, objectKey);
      await client.putObject(conf.bucket, objectKey, body, body.length, { 'Content-Type': contentType });
    },

    async del(objectKey) {
      assertOwnKey(companyId, objectKey);
      await client.removeObject(conf.bucket, objectKey);
    },

    async getReadUrl(objectKey) {
      assertOwnKey(companyId, objectKey);
      return client.presignedGetObject(conf.bucket, objectKey, GET_EXPIRY_S);
    },

    async get(objectKey) {
      assertOwnKey(companyId, objectKey);
      const stream = await client.getObject(conf.bucket, objectKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    },

    canonicalUrl,

    assertMeta(url, objectKey) {
      if (!objectKey.startsWith(`issues/${companyId}/`)) {
        throw new ApiException('VALIDATION_FAILED', '附件 objectKey 与签发前缀不一致');
      }
      if (url !== canonicalUrl(objectKey)) {
        throw new ApiException('VALIDATION_FAILED', '附件 url 不属于本存储后端');
      }
    },
  };
}

/* 设置页「测试连接」：bucket 存在 + 写/删一个探测对象。 */
export async function testMinioConnection(conf: MinioConfig): Promise<void> {
  const client = new Minio.Client({
    endPoint: conf.endpoint,
    port: conf.port,
    useSSL: conf.useSsl,
    accessKey: conf.accessKey,
    secretKey: conf.secretKey,
  });
  if (!(await client.bucketExists(conf.bucket))) {
    throw new ApiException('VALIDATION_FAILED', `bucket ${conf.bucket} 不存在或无权访问`);
  }
  const probe = `.spms-probe-${crypto.randomUUID()}`;
  await client.putObject(conf.bucket, probe, Buffer.from('ok'), 2);
  await client.removeObject(conf.bucket, probe);
}
