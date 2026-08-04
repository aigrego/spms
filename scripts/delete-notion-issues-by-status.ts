/**
 * One-off cleanup (2026-07): 物理删除 Notion 中当前状态为 "More info needed" /
 * "Approval needed" 的已同步 issue。Notion 库为真源:按状态过滤查出页面,
 * 经 notion_issue_links 定位 issue 后 DELETE(关联表均 FK cascade)。
 *
 * 用法:
 *   DATABASE_URL=<目标库> npx tsx scripts/delete-notion-issues-by-status.ts           # 预演,只列出
 *   DATABASE_URL=<目标库> npx tsx scripts/delete-notion-issues-by-status.ts --apply    # 实际删除
 *   DATABASE_URL=<目标库> npx tsx scripts/delete-notion-issues-by-status.ts --local    # 不查 Notion API,
 *     按同步写入描述头的 "Notion: key · 状态 · url" 从库内匹配(状态为上次同步时的快照)
 *   追加参数可覆盖状态名: ... --apply "More info needed" "Approval needed"
 *
 * 注意:issue 在 Vercel Blob 上的附件文件不会随之清理(孤儿文件,需另行处理)。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

for (const file of ['.env.local', '.env']) {
  const p = resolve(process.cwd(), file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, v] = m;
    if (process.env[k] === undefined) process.env[k] = v.replace(/^["']|["']$/g, '');
  }
}

const API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const local = args.includes('--local');
const statuses = args.filter((a) => a !== '--apply' && a !== '--local');
if (statuses.length === 0) statuses.push('More info needed', 'Approval needed');

interface NotionPage {
  id: string;
  properties?: Record<string, { title?: { plain_text?: string }[] }>;
}

/* 带重试的 fetch:Notion API 偶发 ECONNREFUSED/ETIMEDOUT,指数退避 3 次。 */
async function fetchRetry(url: string, init: RequestInit, attempts = 4): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      lastErr = e;
      console.log(`  fetch 失败(${i + 1}/${attempts}),${2 ** i}s 后重试…`);
      await new Promise((r) => setTimeout(r, 2 ** i * 1000));
    }
  }
  throw lastErr;
}

async function queryByStatus(token: string, databaseId: string): Promise<NotionPage[]> {
  const out: NotionPage[] = [];
  let cursor: string | null = null;
  for (;;) {
    const res = await fetchRetry(`${API_BASE}/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        page_size: 100,
        filter: { or: statuses.map((s) => ({ property: 'Status', status: { equals: s } })) },
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      results?: NotionPage[];
      has_more?: boolean;
      next_cursor?: string | null;
    };
    if (!res.ok) throw new Error(`database query failed (HTTP ${res.status})`);
    out.push(...(data.results ?? []));
    if (!data.has_more || !data.next_cursor) return out;
    cursor = data.next_cursor;
  }
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@livebook:5433/next_spms');
  console.log(
    `mode: ${apply ? 'APPLY (物理删除)' : 'DRY-RUN (只列出)'}${local ? ' + LOCAL (库内匹配,不查 Notion)' : ''}; statuses: ${statuses.join(' / ')}`,
  );

  const conns = await sql<{ id: string; database_id: string | null; access_token: string }[]>`
    SELECT id, database_id, access_token FROM notion_connections
  `;

  let totalDeleted = 0;
  for (const conn of conns) {
    let rows: { issue_id: string; key: string; title: string }[];
    if (local) {
      // 描述头(每次同步重建):"Notion: <key> · <status> · <url>"。
      const like = statuses.map((s) => sql`i.description LIKE ${`Notion: % · ${s} · %`}`);
      const anyLike = like.reduce((a, b) => sql`${a} OR ${b}`);
      rows = await sql`
        SELECT l.issue_id, i.key, i.title
        FROM notion_issue_links l JOIN issues i ON i.id = l.issue_id
        WHERE l.connection_id = ${conn.id} AND (${anyLike})
      `;
      console.log(`connection ${conn.id}: 库内匹配 issue ${rows.length}`);
    } else {
      if (!conn.database_id) continue;
      const pages = await queryByStatus(conn.access_token, conn.database_id);
      if (pages.length === 0) {
        console.log(`connection ${conn.id}: 匹配页面 0`);
        continue;
      }
      const pageIds = pages.map((p) => p.id);
      rows = await sql`
        SELECT l.issue_id, i.key, i.title
        FROM notion_issue_links l JOIN issues i ON i.id = l.issue_id
        WHERE l.connection_id = ${conn.id} AND l.notion_page_id = ANY(${pageIds})
      `;
      console.log(`connection ${conn.id}: 匹配页面 ${pages.length},已同步 issue ${rows.length}`);
    }
    for (const r of rows) console.log(`  ${r.key}  ${r.title}`);

    if (apply && rows.length > 0) {
      const ids = rows.map((r) => r.issue_id);
      const deleted = await sql`DELETE FROM issues WHERE id = ANY(${ids})`;
      console.log(`  deleted ${deleted.count}`);
      totalDeleted += Number(deleted.count);
    }
  }

  console.log(apply ? `done — 共删除 ${totalDeleted} 条 issue` : 'dry-run — 加 --apply 执行删除');
  await sql.end();
}

main();
