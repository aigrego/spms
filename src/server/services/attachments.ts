import { del } from '@vercel/blob';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { issueAttachments, issues } from '@/db/schema';
import { serializeAttachment } from '@/lib/serialize';
import { ApiException } from '@/lib/envelope';
import { ATTACHMENT_PATH_PREFIX, isAllowedType } from '@/lib/attachments';
import { requirePerm } from '@/lib/permissions';
import type { Actor } from './types';

/* Issue attachments (Vercel Blob, client-direct upload). The browser
   uploads the file straight to Blob via the /attachments/upload token route,
   then calls registerAttachment to persist the row. Deleting removes the row
   first, then the blob (best-effort — a failed blob delete leaves an orphan
   for scripts/reconcile-attachments.ts). Images and common document formats
   (see src/lib/attachments.ts). Module gate: `issues` write. */

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

/* 期望的 blob host:与 @vercel/blob SDK 同款,从 BLOB_READ_WRITE_TOKEN
   (vercel_blob_rw_<storeId>_<secret>)解析 storeId,拼出 public 域名。
   解析不到(未配置)时返回 null,调用方退化为只校验 Vercel Blob 公共域名后缀。 */
function expectedBlobHost(): string | null {
  const storeId = process.env.BLOB_READ_WRITE_TOKEN?.split('_')[3];
  return storeId ? `${storeId}.public.blob.vercel-storage.com` : null;
}

/* 不信任客户端上报的 url/pathname:url 必须是指向本 blob 存储的 https 地址,
   pathname 必须以 token 签发时的前缀(ATTACHMENT_PATH_PREFIX)开头 —
   防止把任意外部 URL 注册为「附件」,绕过 upload token 路由的限制。 */
function assertBlobMeta(url: string, pathname: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApiException('VALIDATION_FAILED', '附件 url 不是合法 URL');
  }
  const expected = expectedBlobHost();
  const hostOk = expected ? parsed.host === expected : parsed.host.endsWith('.public.blob.vercel-storage.com');
  if (parsed.protocol !== 'https:' || !hostOk) {
    throw new ApiException('VALIDATION_FAILED', '附件 url 不属于本 blob 存储');
  }
  if (!pathname.startsWith(ATTACHMENT_PATH_PREFIX)) {
    throw new ApiException('VALIDATION_FAILED', '附件 pathname 与签发前缀不一致');
  }
}

export interface RegisterAttachmentInput {
  url: string;
  pathname: string;
  filename: string;
  contentType: string;
  size: number;
}

/* ---- register an already-uploaded blob as an issue attachment ---- */
export async function registerAttachment(actor: Actor, issueKey: string, meta: RegisterAttachmentInput) {
  await requirePerm(actor, 'issues', 'write');
  const companyId = actor.companyId;
  const [issue] = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.companyId, companyId), eq(issues.key, issueKey)))
    .limit(1);
  if (!issue) throw new ApiException('ISSUE_NOT_FOUND', `Issue ${issueKey} 不存在`);

  if (!meta.url?.trim() || !meta.pathname?.trim()) {
    throw new ApiException('VALIDATION_FAILED', '附件 url/pathname 不能为空');
  }
  assertBlobMeta(meta.url, meta.pathname);
  if (!meta.contentType || !isAllowedType(meta.contentType)) {
    throw new ApiException('VALIDATION_FAILED', '不支持的附件格式');
  }
  if (!Number.isFinite(meta.size) || meta.size <= 0 || meta.size > MAX_ATTACHMENT_SIZE) {
    throw new ApiException('VALIDATION_FAILED', '附件大小需在 10MB 以内');
  }

  const id = crypto.randomUUID();
  await db.insert(issueAttachments).values({
    id,
    companyId,
    issueId: issue.id,
    url: meta.url,
    pathname: meta.pathname,
    filename: meta.filename?.trim() || 'file',
    contentType: meta.contentType,
    size: meta.size,
    uploadedById: actor.memberId,
  });
  const [row] = await db.select().from(issueAttachments).where(eq(issueAttachments.id, id)).limit(1);
  return serializeAttachment(row);
}

/* ---- list an issue's attachments (oldest first) ---- */
export async function listAttachments(actor: Actor, issueKey: string) {
  await requirePerm(actor, 'issues', 'read');
  const [issue] = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.companyId, actor.companyId), eq(issues.key, issueKey)))
    .limit(1);
  if (!issue) throw new ApiException('ISSUE_NOT_FOUND', `Issue ${issueKey} 不存在`);
  const rows = await db
    .select()
    .from(issueAttachments)
    .where(eq(issueAttachments.issueId, issue.id))
    .orderBy(asc(issueAttachments.createdAt));
  return rows.map(serializeAttachment);
}

/* ---- delete: 先删 DB 行再删 blob;blob 删除失败只记告警不抛错 —— 孤儿
   blob 由 scripts/reconcile-attachments.ts 对账清理,不影响行已删的事实 ---- */
export async function deleteAttachment(actor: Actor, attachmentId: string) {
  await requirePerm(actor, 'issues', 'write');
  const [row] = await db
    .select()
    .from(issueAttachments)
    .where(and(eq(issueAttachments.companyId, actor.companyId), eq(issueAttachments.id, attachmentId)))
    .limit(1);
  if (!row) throw new ApiException('ATTACHMENT_NOT_FOUND');
  await db.delete(issueAttachments).where(eq(issueAttachments.id, row.id));
  try {
    await del(row.url);
  } catch (e) {
    console.warn(`[attachments] blob 删除失败,留待对账清理: ${row.pathname}`, e);
  }
  return { id: row.id };
}
