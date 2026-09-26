/* Storage backend contract (per-company file storage). Objects live under the
   key prefix `{companyId}/` inside the company's own backend — the prefix is
   the company-isolation boundary: upload signing, registration and the read
   proxy all verify it. Full key rule:
     {companyId}/{category}/{userSegment}/{fileType}/{uuid}-{safeName}
   category ∈ issues|cases|requirements; userSegment = uploader's member id
   (reserved word `system` for Notion sync and seat-less actors); fileType is
   derived from the MIME type (fileTypeOf in src/lib/attachments.ts).
   LEGACY-KEY: pre-rekey objects sit under `issues/{companyId}/`; read/delete
   paths accept both formats during the migration window, write paths mint and
   accept new-format keys only. Company storage provisioning is triggered
   manually by the platform admin (设置 → 公司管理 → 开通存储), never
   implicitly on first upload. */

import type { AttachmentFileType } from '@/lib/attachments';

export const ATTACHMENT_CATEGORIES = ['issues', 'cases', 'requirements'] as const;
export type AttachmentCategory = (typeof ATTACHMENT_CATEGORIES)[number];

export type UploadIntent =
  // MinIO/S3 presigned PUT: the browser PUTs the file straight to uploadUrl.
  { mode: 'presigned-put'; uploadUrl: string; objectKey: string };

/* Key segments the server pins at intent/mint time. Clients never pick any
   key segment themselves: category comes from a server-side mapping (or the
   upload intent's restricted enum), userSegment is always the actor's
   memberId taken server-side. */
export interface KeyingSegments {
  category: AttachmentCategory;
  userSegment: string;
  contentType?: string;
}

export interface StorageBackend {
  readonly kind: 'minio';
  readonly companyId: string;

  /* Browser upload: server-minted intent (object key is always
     server-generated — clients never pick their own keys). */
  createUploadIntent(filename: string, keying: KeyingSegments): Promise<UploadIntent>;

  /* Server-side bypass upload (MCP tool, Notion sync). New-format keys only. */
  put(objectKey: string, body: Buffer, contentType: string): Promise<void>;

  del(objectKey: string): Promise<void>;

  /* Short-lived absolute URL the read proxy 302s to (MinIO presigned GET). */
  getReadUrl(objectKey: string): Promise<string>;

  /* Server-side read (MCP inlines images) — company isolation already
     enforced by the caller. */
  get(objectKey: string): Promise<Buffer>;

  /* The canonical backend address stored in attachments.url and checked
     by assertMeta. An identity marker, not necessarily readable (private
     buckets refuse anonymous GETs). */
  canonicalUrl(objectKey: string): string;

  /* Registration-time validation of client-reported meta: the url must be the
     canonical one for (this backend, objectKey), the key must be ours (new
     format only), and its category/userSegment segments must match what the
     server pinned at intent time. Throws ApiException(VALIDATION_FAILED) on
     mismatch. */
  assertMeta(url: string, objectKey: string, expected: { category: AttachmentCategory; userSegment: string }): void;
}

export const objectKeyPrefix = (companyId: string) => `${companyId}/`;

/* LEGACY-KEY: pre-rekey prefix (`issues/{companyId}/`). Read/delete compat
   only — remove together with the dual-format branches once legacy objects
   are cleaned up and policies tightened (plan M5). */
const legacyObjectKeyPrefix = (companyId: string) => `issues/${companyId}/`;

export function assertOwnKey(companyId: string, objectKey: string): void {
  if (objectKey.startsWith(objectKeyPrefix(companyId))) return;
  // LEGACY-KEY: 读/删路径兼容重键前对象；写路径只认新格式（见 minio.put /
  // createUploadIntent / assertMeta）。
  if (objectKey.startsWith(legacyObjectKeyPrefix(companyId))) return;
  throw new Error(`object key ${objectKey} 不属于公司 ${companyId} 的前缀`);
}

/* {companyId}/{category}/{userSegment}/{fileType}/{uuid}-{safeName} — uuid
   guarantees uniqueness (no random-suffix reliance), safeName keeps it
   readable. */
export function newObjectKey(
  companyId: string,
  category: AttachmentCategory,
  userSegment: string,
  fileType: AttachmentFileType,
  filename: string,
): string {
  const safe = (filename || 'file').replace(/[^\w.一-龥-]+/g, '_').slice(-80);
  return `${companyId}/${category}/${userSegment}/${fileType}/${crypto.randomUUID()}-${safe}`;
}

/* The companyId embedded in an object key (null = not an attachment key).
   Dual format: new keys carry it as segment 1; LEGACY-KEY: pre-rekey
   `issues/{companyId}/…` keys carry it as segment 2. */
export function companyIdFromKey(objectKey: string): string | null {
  // LEGACY-KEY branch first — a new-format key's first segment is a company
  // id, never the literal 'issues'.
  const legacy = /^issues\/([^/]+)\//.exec(objectKey);
  if (legacy) return legacy[1] ?? null;
  const seg = objectKey.split('/');
  return seg.length >= 2 && seg[0] ? seg[0] : null;
}

/* The category segment (segment 2) of a new-format key; null when the segment
   is outside the enum. LEGACY-KEY: `issues/{companyId}/…` keys carry no
   category segment → null. */
export function categoryFromKey(objectKey: string): AttachmentCategory | null {
  if (/^issues\/[^/]+\//.test(objectKey)) return null; // LEGACY-KEY
  const c = objectKey.split('/')[1];
  return (ATTACHMENT_CATEGORIES as readonly string[]).includes(c) ? (c as AttachmentCategory) : null;
}
