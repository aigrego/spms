import { env } from '@/lib/env';

/* Notion public-integration OAuth + REST API helpers (阶段 1: 连接 + 预览).
   Enabled only when NOTION_CLIENT_ID / NOTION_CLIENT_SECRET are set; the
   redirect URI defaults to <origin>/api/v1/pms/integrations/notion/callback
   unless NOTION_REDIRECT_URI overrides it. Every API call carries the pinned
   Notion-Version header; the access token never expires (v1: no refresh). */

const API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export function notionConfigured(): boolean {
  return !!(env.notionClientId && env.notionClientSecret);
}

export function notionRedirectUri(origin: string): string {
  return env.notionRedirectUri ?? `${origin}/api/v1/pms/integrations/notion/callback`;
}

/* The authorization URL the browser is sent to (302). `state` is the CSRF
   nonce verified against NOTION_STATE_COOKIE in the callback. */
export function notionAuthorizeUrl(origin: string, state: string): string {
  const redirect = encodeURIComponent(notionRedirectUri(origin));
  return (
    `${API_BASE}/oauth/authorize?client_id=${env.notionClientId}` +
    `&redirect_uri=${redirect}&response_type=code&owner=user&state=${state}`
  );
}

/* HttpOnly cookie carrying the OAuth nonce between /authorize and /callback —
   proves the flow was initiated by this browser (CSRF guard, same pattern as
   lark BIND_STATE_COOKIE). */
export const NOTION_STATE_COOKIE = 'spms_notion_oauth';

export interface NotionTokenResult {
  accessToken: string;
  botId?: string;
  workspaceId?: string;
  workspaceName?: string;
}

/* authorization code → access token (Basic auth client_id:secret).
   Throws on any failure. */
export async function exchangeCode(code: string, origin: string): Promise<NotionTokenResult> {
  const basic = Buffer.from(`${env.notionClientId}:${env.notionClientSecret}`).toString('base64');
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basic}` },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: notionRedirectUri(origin),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    bot_id?: string;
    workspace_id?: string;
    workspace_name?: string;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(`token exchange failed (${data.error ?? `HTTP ${res.status}`})`);
  }
  return {
    accessToken: data.access_token,
    botId: data.bot_id,
    workspaceId: data.workspace_id,
    workspaceName: data.workspace_name,
  };
}

function notionHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

export interface NotionDatabaseOption {
  id: string;
  name: string;
}

/* Search API filtered to the databases this integration can access. */
export async function searchDatabases(token: string): Promise<NotionDatabaseOption[]> {
  const res = await fetch(`${API_BASE}/search`, {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify({ filter: { property: 'object', value: 'database' }, page_size: 100 }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    results?: { id: string; title?: { plain_text?: string }[] }[];
  };
  if (!res.ok) throw new Error(`database search failed (HTTP ${res.status})`);
  return (data.results ?? []).map((d) => ({
    id: d.id,
    name: (d.title ?? []).map((t) => t.plain_text ?? '').join('').trim() || d.id,
  }));
}

/* The most recently edited page of a database, as raw Notion page JSON
   (阶段 1 preview: 用来与真实客户库核对字段结构). */
export async function queryDatabaseFirstPage(token: string, databaseId: string): Promise<unknown | null> {
  const res = await fetch(`${API_BASE}/databases/${databaseId}/query`, {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify({
      page_size: 1,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as { results?: unknown[] };
  if (!res.ok) throw new Error(`database query failed (HTTP ${res.status})`);
  return data.results?.[0] ?? null;
}

/* A Notion page object, loosely typed — the sync engine picks properties by
   name and narrows them itself (v1 mapping is tied to one database shape). */
export interface NotionPageObject {
  id: string;
  url?: string;
  archived?: boolean;
  in_trash?: boolean;
  last_edited_time: string;
  properties?: Record<string, unknown>;
}

/* Pages of a database, most recently edited first, paginated (100/page).
   Early-stops once it reaches a page whose last_edited_time is at/before
   `since` (the sync watermark) — everything older is already synced. */
export async function queryDatabase(
  token: string,
  databaseId: string,
  since?: Date | null,
): Promise<NotionPageObject[]> {
  const out: NotionPageObject[] = [];
  let cursor: string | null = null;
  for (;;) {
    const res = await fetch(`${API_BASE}/databases/${databaseId}/query`, {
      method: 'POST',
      headers: notionHeaders(token),
      body: JSON.stringify({
        page_size: 100,
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      results?: NotionPageObject[];
      has_more?: boolean;
      next_cursor?: string | null;
    };
    if (!res.ok) throw new Error(`database query failed (HTTP ${res.status})`);
    let reachedWatermark = false;
    for (const page of data.results ?? []) {
      if (since && page.last_edited_time && new Date(page.last_edited_time) <= since) {
        reachedWatermark = true;
        break;
      }
      out.push(page);
    }
    if (reachedWatermark || !data.has_more || !data.next_cursor) return out;
    cursor = data.next_cursor;
  }
}

/* A Notion block object, loosely typed (the sync engine only reads image blocks). */
export interface NotionBlockObject {
  id: string;
  type: string;
  [key: string]: unknown;
}

/* All children blocks of a page (paginated, 100/page). */
export async function getPageBlocks(token: string, pageId: string): Promise<NotionBlockObject[]> {
  const out: NotionBlockObject[] = [];
  let cursor: string | null = null;
  for (;;) {
    const url =
      `${API_BASE}/blocks/${pageId}/children?page_size=100` + (cursor ? `&start_cursor=${cursor}` : '');
    const res = await fetch(url, {
      headers: notionHeaders(token),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      results?: NotionBlockObject[];
      has_more?: boolean;
      next_cursor?: string | null;
    };
    if (!res.ok) throw new Error(`block children failed (HTTP ${res.status})`);
    out.push(...(data.results ?? []));
    if (!data.has_more || !data.next_cursor) return out;
    cursor = data.next_cursor;
  }
}

export const MAX_NOTION_FILE_BYTES = 10 * 1024 * 1024; // 10MB, matches attachment limit

/* Download a Notion-hosted (presigned, no auth needed) or external file.
   Returns null when the file exceeds the 10MB attachment cap (caller skips
   silently); throws on real failures. */
export async function downloadFile(
  url: string,
  maxBytes = MAX_NOTION_FILE_BYTES,
): Promise<{ buffer: Buffer; contentType: string | null } | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`file download failed (HTTP ${res.status})`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxBytes) return null;
  return { buffer, contentType: res.headers.get('content-type') };
}
