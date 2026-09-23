import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { issueAttachments, issues } from '@/db/schema';
import { serializeAttachment } from '@/lib/serialize';
import { ApiException } from '@/lib/envelope';
import { isAllowedType } from '@/lib/attachments';
import { requirePerm } from '@/lib/permissions';
import { storageForCompany } from '@/server/storage';
import type { Actor } from './types';

/* Issue attachments (per-company storage backend, client-direct upload). The
   browser uploads straight to the company's backend via the
   /attachments/upload intent route, then registerAttachment persists the row
   (server-side meta validation via storage.assertMeta). Reads go through the
   /attachments/object proxy (company isolation). Deleting removes the row
   first, then the object (best-effort — a failed delete leaves an orphan for
   scripts/reconcile-attachments.ts). Module gate: `issues` write. */

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

export interface RegisterAttachmentInput {
  url: string;
  pathname: string; // = 对象 key（issues/{companyId}/…）
  filename: string;
  contentType: string;
  size: number;
}

/* ---- register an already-uploaded object as an issue attachment ---- */
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
  // 不信任客户端上报的 url/pathname：必须属于本公司存储后端与本公司的 key 前缀。
  const storage = await storageForCompany(companyId);
  storage.assertMeta(meta.url, meta.pathname);
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
    objectKey: meta.pathname,
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

/* ---- delete: 先删 DB 行再删对象;对象删除失败只记告警不抛错 —— 孤儿
   由 scripts/reconcile-attachments.ts 对账清理,不影响行已删的事实 ---- */
export async function deleteAttachment(actor: Actor, attachmentId: string) {
  await requirePerm(actor, 'issues', 'write');
  const [row] = await db
    .select()
    .from(issueAttachments)
    .where(and(eq(issueAttachments.companyId, actor.companyId), eq(issueAttachments.id, attachmentId)))
    .limit(1);
  if (!row) throw new ApiException('ATTACHMENT_NOT_FOUND');
  await db.delete(issueAttachments).where(eq(issueAttachments.id, row.id));
  // objectKey 为 null 的是平台级 Vercel Blob 时代的旧行:运行时已不再持有那个
  // token,删除留给 reconcile 脚本(--apply)按存量 token 处理。
  if (row.objectKey) {
    try {
      const storage = await storageForCompany(actor.companyId);
      await storage.del(row.objectKey);
    } catch (e) {
      console.warn(`[attachments] 对象删除失败,留待对账清理: ${row.objectKey}`, e);
    }
  }
  return { id: row.id };
}
