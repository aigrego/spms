/**
 * One-off backfill (2026-07): Notion 同步建的 issue 的 created_at 原本落的是
 * 同步时刻,本脚本把 notion_issue_links 映射到的 issue 的 created_at 回写为
 * Notion 页面的 created_time。之后 notionSync 创建/更新路径已自带回写,
 * 本脚本只为收敛存量。
 *
 * 用法: DATABASE_URL=<目标库> npx tsx scripts/backfill-notion-created-at.ts
 * (默认读 .env.local / .env;显式环境变量优先。)
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

interface NotionPage {
  id: string;
  created_time?: string;
}

/* 全量翻页(不带水位,回填需要每一页)。 */
async function queryAllPages(token: string, databaseId: string): Promise<NotionPage[]> {
  const out: NotionPage[] = [];
  let cursor: string | null = null;
  for (;;) {
    const res = await fetch(`${API_BASE}/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        page_size: 100,
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
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
  const sql = postgres(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@livebook:5433/spms');

  const conns = await sql<{ id: string; company_id: string; database_id: string | null; access_token: string }[]>`
    SELECT id, company_id, database_id, access_token FROM notion_connections
  `;

  let totalUpdated = 0;
  for (const conn of conns) {
    if (!conn.database_id) {
      console.log(`connection ${conn.id}: 未选数据库,跳过`);
      continue;
    }
    const pages = await queryAllPages(conn.access_token, conn.database_id);
    const createdByPage = new Map(pages.filter((p) => p.created_time).map((p) => [p.id, p.created_time!]));

    const links = await sql<{ notion_page_id: string; issue_id: string; created_at: string }[]>`
      SELECT l.notion_page_id, l.issue_id, i.created_at
      FROM notion_issue_links l
      JOIN issues i ON i.id = l.issue_id
      WHERE l.connection_id = ${conn.id}
    `;

    let updated = 0;
    for (const link of links) {
      const notionCreated = createdByPage.get(link.notion_page_id);
      if (!notionCreated) continue;
      if (Math.abs(+new Date(link.created_at) - +new Date(notionCreated)) < 1000) continue;
      await sql`UPDATE issues SET created_at = ${notionCreated} WHERE id = ${link.issue_id}`;
      updated++;
    }
    console.log(`connection ${conn.id}: 页面 ${pages.length},映射 ${links.length},回写 ${updated}`);
    totalUpdated += updated;
  }

  console.log(`done — 共回写 ${totalUpdated} 条 issue 的 created_at`);
  await sql.end();
}

main();
