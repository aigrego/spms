import { del, put } from '@vercel/blob';
import { ApiException } from '@/lib/envelope';
import { assertOwnKey, newObjectKey, type StorageBackend, type UploadIntent } from './types';

/* Vercel Blob backend — same client-direct protocol as before, but the token
   now comes from the company's storage config (DB, encrypted) instead of the
   platform-level BLOB_READ_WRITE_TOKEN env. */

/* 从 token (vercel_blob_rw_<storeId>_<secret>) 解析 storeId 拼出 public 域名。
   token 内嵌的 storeId 是大小写混合的,而 blob 公共域名一律小写,必须转小写。
   解析不到返回 null,调用方退化为只校验公共域名后缀。 */
function storeHost(token: string): string | null {
  const storeId = token.split('_')[3];
  return storeId ? `${storeId.toLowerCase()}.public.blob.vercel-storage.com` : null;
}

export function vercelBackend(companyId: string, token: string): StorageBackend {
  const publicUrl = (key: string) => {
    const host = storeHost(token);
    if (!host) throw new Error('Vercel Blob token 无法解析出 storeId');
    return `https://${host}/${key}`;
  };

  return {
    kind: 'vercel_blob',
    companyId,
    vercelToken: token,

    // 客户端拿到 objectKey 后走 @vercel/blob/client 的 upload() 握手,
    // token 签发路由按 issues/{companyId}/ 前缀校验该 pathname。
    async createUploadIntent(filename: string): Promise<UploadIntent> {
      return { mode: 'vercel-token', objectKey: newObjectKey(companyId, filename) };
    },

    async put(objectKey, body, contentType) {
      assertOwnKey(companyId, objectKey);
      await put(objectKey, body, { access: 'public', contentType, token, addRandomSuffix: false });
    },

    async del(objectKey) {
      assertOwnKey(companyId, objectKey);
      await del(objectKey, { token });
    },

    async getReadUrl(objectKey) {
      assertOwnKey(companyId, objectKey);
      return publicUrl(objectKey);
    },

    async get(objectKey) {
      const res = await fetch(publicUrl(objectKey));
      if (!res.ok) throw new Error(`blob GET failed (status=${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },

    canonicalUrl: publicUrl,

    /* 不信任客户端上报的 url/pathname:url 必须是指向本 blob store 的 https
       地址,pathname 必须以签发前缀开头 —— 防止把任意外部 URL 注册为附件。 */
    assertMeta(url, objectKey) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new ApiException('VALIDATION_FAILED', '附件 url 不是合法 URL');
      }
      const expected = storeHost(token);
      const hostOk = expected ? parsed.host === expected : parsed.host.endsWith('.public.blob.vercel-storage.com');
      if (parsed.protocol !== 'https:' || !hostOk) {
        throw new ApiException('VALIDATION_FAILED', '附件 url 不属于本 blob 存储');
      }
      if (!objectKey.startsWith(`issues/${companyId}/`)) {
        throw new ApiException('VALIDATION_FAILED', '附件 pathname 与签发前缀不一致');
      }
      if (parsed.pathname.replace(/^\//, '') !== objectKey) {
        throw new ApiException('VALIDATION_FAILED', '附件 url 与 pathname 不一致');
      }
    },
  };
}

/* 设置页「测试连接」：写/删一个探测对象。 */
export async function testVercelConnection(token: string): Promise<void> {
  const probe = `.spms-probe/${crypto.randomUUID()}`;
  await put(probe, Buffer.from('ok'), { access: 'public', token, addRandomSuffix: false });
  await del(probe, { token });
}
