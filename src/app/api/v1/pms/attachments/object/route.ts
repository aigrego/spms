import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { issueAttachments } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { requireActor, route } from '@/server/http';
import { companyIdFromKey, storageForCompany } from '@/server/storage';

/* GET /api/v1/pms/attachments/object?id=<attachmentId> 或 ?key=<objectKey>
   附件/嵌入图片的读取代理：存储后端的对象一律私有，浏览器拿到的是这个稳定
   的应用内地址（<img>/markdown 直接可用），本路由鉴权后 302 到后端的真实
   地址（MinIO 短时效 presigned GET；Vercel 公网 url）。
   公司隔离强制点：
   - ?id=  行级校验 attachment.companyId === actor.companyId；
   - ?key= 对象 key 内嵌的 companyId 必须等于 actor.companyId —— 评论/描述里
     粘贴的图片不注册 attachment 行，key 前缀即归属证明。
   旧行（objectKey 为 null，平台级 Vercel Blob 时代的公网 url）直接 302 到
   其存量的 url 以兼容历史数据。 */
export const GET = route(async (req) => {
  const actor = await requireActor();
  const id = req.nextUrl.searchParams.get('id');
  const key = req.nextUrl.searchParams.get('key');

  let target: string;
  if (id) {
    const [row] = await db
      .select()
      .from(issueAttachments)
      .where(and(eq(issueAttachments.companyId, actor.companyId), eq(issueAttachments.id, id)))
      .limit(1);
    if (!row) throw new ApiException('ATTACHMENT_NOT_FOUND', '附件不存在', 404);
    if (row.objectKey) {
      const storage = await storageForCompany(actor.companyId);
      target = await storage.getReadUrl(row.objectKey);
    } else {
      target = row.url; // legacy 公网 url
    }
  } else if (key) {
    if (companyIdFromKey(key) !== actor.companyId) throw new ApiException('FORBIDDEN', '无权访问该文件', 403);
    const storage = await storageForCompany(actor.companyId);
    target = await storage.getReadUrl(key);
  } else {
    throw new ApiException('VALIDATION_FAILED', '缺少 id 或 key 参数');
  }

  // presigned url 短时效,禁止任何缓存把 302 目标固化下来。
  const res = NextResponse.redirect(target, 302);
  res.headers.set('Cache-Control', 'private, no-cache');
  return res;
});
