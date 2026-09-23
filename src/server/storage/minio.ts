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
  /* 浏览器可达的公网基址（如 https://s3.innev.cn）。应用部署在域名/反代后时，
     预签名 URL 必须按公网 host 签发（V4 签名覆盖 host 头，浏览器必须按签发
     的 host 请求才校验得过）；null/缺省 = 用内网 endpoint 直签（纯内网部署）。 */
  publicBaseUrl?: string | null;
}

/* 把公网基址解析成 minio 客户端参数 + 规范化基址。规范化规则（protocol//host，
   默认端口省略、无路径无尾斜杠）与 minio-js 渲染预签名 URL 的规则一致
   （getRequestOptions：仅非默认端口才拼 :port），保证 canonicalUrl 与浏览器
   注册时 uploadUrl 去 query 的结果逐字节相等。 */
export function parsePublicBaseUrl(raw: string): { endPoint: string; port: number; useSSL: boolean; base: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new ApiException('VALIDATION_FAILED', '公网访问地址不是合法 URL（如 https://s3.innev.cn）');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new ApiException('VALIDATION_FAILED', '公网访问地址仅支持 http/https');
  }
  if (u.pathname !== '/' || u.search || u.hash) {
    throw new ApiException('VALIDATION_FAILED', '公网访问地址不能带路径或查询串（bucket 由 bucket 字段指定）');
  }
  const useSSL = u.protocol === 'https:';
  const port = u.port ? Number(u.port) : useSSL ? 443 : 80;
  const isDefaultPort = (useSSL && port === 443) || (!useSSL && port === 80);
  return {
    endPoint: u.hostname,
    port,
    useSSL,
    base: `${u.protocol}//${u.hostname}${isDefaultPort ? '' : `:${port}`}`,
  };
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

  /* 预签名专用客户端：配了公网基址就按公网 host 签发（浏览器直传/302 读取
     都发生在浏览器侧），否则回落内网 endpoint。region 写死 us-east-1，避免
     presign 前的 getBucketRegion 探活请求打到公网地址（服务端可能不可达）。 */
  const pub = conf.publicBaseUrl ? parsePublicBaseUrl(conf.publicBaseUrl) : null;
  const presignClient = pub
    ? new Minio.Client({
        endPoint: pub.endPoint,
        port: pub.port,
        useSSL: pub.useSSL,
        accessKey: conf.accessKey,
        secretKey: conf.secretKey,
        region: 'us-east-1',
      })
    : client;

  /* 规范 url：仅作为身份标识存入 DB 并通过 assertMeta 校验 —— bucket 是私有的,
     该 url 公网不可读,真正的读取走代理路由。配了公网基址时以公网基址为准
     （与浏览器注册时上报的 uploadUrl 去 query 保持一致）。 */
  const canonicalUrl = (key: string) =>
    pub
      ? `${pub.base}/${conf.bucket}/${key}`
      : `${conf.useSsl ? 'https' : 'http'}://${conf.endpoint}:${conf.port}/${conf.bucket}/${key}`;

  return {
    kind: 'minio',
    companyId,

    async createUploadIntent(filename: string): Promise<UploadIntent> {
      const objectKey = newObjectKey(companyId, filename);
      const uploadUrl = await presignClient.presignedPutObject(conf.bucket, objectKey, PUT_EXPIRY_S);
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
      return presignClient.presignedGetObject(conf.bucket, objectKey, GET_EXPIRY_S);
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
