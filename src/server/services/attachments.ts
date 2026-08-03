import { del } from '@vercel/blob';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { issueAttachments, issues } from '@/db/schema';
import { serializeAttachment } from '@/lib/serialize';
import { ApiException } from '@/lib/envelope';
import { isAllowedType } from '@/lib/attachments';
import { requirePerm } from '@/lib/permissions';
import type { Actor } from './types';

/* Issue attachments (Vercel Blob, client-direct upload). The browser
   uploads the file straight to Blob via the /attachments/upload token route,
   then calls registerAttachment to persist the row. Deleting removes both the
   blob and the row. Images and common document formats (see
   src/lib/attachments.ts). Module gate: `issues` write. */

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

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

/* ---- delete: remove the blob, then the row ---- */
export async function deleteAttachment(actor: Actor, attachmentId: string) {
  await requirePerm(actor, 'issues', 'write');
  const [row] = await db
    .select()
    .from(issueAttachments)
    .where(and(eq(issueAttachments.companyId, actor.companyId), eq(issueAttachments.id, attachmentId)))
    .limit(1);
  if (!row) throw new ApiException('ATTACHMENT_NOT_FOUND');
  await del(row.url);
  await db.delete(issueAttachments).where(eq(issueAttachments.id, row.id));
  return { id: row.id };
}
