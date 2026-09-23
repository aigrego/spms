/* Storage backend contract (per-company file storage). Objects live under the
   key prefix `issues/{companyId}/` inside the company's own backend — the
   prefix is the company-isolation boundary: upload signing, registration and
   the read proxy all verify it. */

export type UploadIntent =
  // Vercel Blob client-direct: the browser then calls @vercel/blob/client's
  // upload() with this pathname; the token route signs it (prefix-checked).
  | { mode: 'vercel-token'; objectKey: string }
  // MinIO/S3 presigned PUT: the browser PUTs the file straight to uploadUrl.
  | { mode: 'presigned-put'; uploadUrl: string; objectKey: string };

export interface StorageBackend {
  readonly kind: 'minio' | 'vercel_blob';
  readonly companyId: string;

  /* Browser upload: server-minted intent (object key is always
     server-generated — clients never pick their own keys). */
  createUploadIntent(filename: string): Promise<UploadIntent>;

  /* Server-side bypass upload (MCP tool, Notion sync). */
  put(objectKey: string, body: Buffer, contentType: string): Promise<void>;

  del(objectKey: string): Promise<void>;

  /* Short-lived absolute URL the read proxy 302s to (MinIO presigned GET;
     Vercel public URL derived from the token's storeId). */
  getReadUrl(objectKey: string): Promise<string>;

  /* Server-side read (MCP inlines images) — company isolation already
     enforced by the caller. */
  get(objectKey: string): Promise<Buffer>;

  /* The canonical backend address stored in issue_attachments.url and checked
     by assertMeta. An identity marker, not necessarily readable (private
     buckets refuse anonymous GETs). */
  canonicalUrl(objectKey: string): string;

  /* Registration-time validation of client-reported meta: the url must be the
     canonical one for (this backend, objectKey) and the key must be ours.
     Throws ApiException(VALIDATION_FAILED) on mismatch. */
  assertMeta(url: string, objectKey: string): void;

  /* Vercel only: decrypted token for the handleUpload token handshake. */
  readonly vercelToken?: string;
}

export const objectKeyPrefix = (companyId: string) => `issues/${companyId}/`;

export function assertOwnKey(companyId: string, objectKey: string): void {
  if (!objectKey.startsWith(objectKeyPrefix(companyId))) {
    throw new Error(`object key ${objectKey} 不属于公司 ${companyId} 的前缀`);
  }
}

/* issues/{companyId}/{uuid}-{safeName} — uuid guarantees uniqueness (no
   random-suffix reliance), safeName keeps it readable. */
export function newObjectKey(companyId: string, filename: string): string {
  const safe = (filename || 'file').replace(/[^\w.一-龥-]+/g, '_').slice(-80);
  return `${objectKeyPrefix(companyId)}${crypto.randomUUID()}-${safe}`;
}

/* The companyId embedded in an object key (null = not an attachment key). */
export function companyIdFromKey(objectKey: string): string | null {
  const m = /^issues\/([^/]+)\//.exec(objectKey);
  return m?.[1] ?? null;
}
