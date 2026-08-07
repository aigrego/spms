/**
 * 附件对账 (TKT-18): 对照 issue_attachments 表与 Vercel Blob 存储,找出两类漂移 —
 *   - 孤儿 blob: 存储里存在(附件签发前缀下)但 DB 无附件行。来源:删除附件
 *     「先删行后删 blob」中 blob 删除失败、issue 删除只 FK 级联了 DB 行等;
 *   - 死链行: DB 有附件行但 blob 已不存在(存储侧被手工清理等)。
 * 默认 dry-run 只打印,--apply 才实删(孤儿删 blob,死链删行;blob 删除失败
 * 只告警,下次对账再清)。
 *
 * 用法:
 *   DATABASE_URL=<目标库> BLOB_READ_WRITE_TOKEN=<token> npx tsx scripts/reconcile-attachments.ts           # 预演,只列出
 *   DATABASE_URL=<目标库> BLOB_READ_WRITE_TOKEN=<token> npx tsx scripts/reconcile-attachments.ts --apply    # 实际清理
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { del, list } from '@vercel/blob';
import postgres from 'postgres';
import { ATTACHMENT_PATH_PREFIX } from '../src/lib/attachments';

// Load .env.local / .env (Next only auto-loads these for `next` commands).
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

const apply = process.argv.includes('--apply');

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@livebook:5433/spms');
  console.log(`mode: ${apply ? 'APPLY (实删)' : 'DRY-RUN (只列出)'}; prefix: ${ATTACHMENT_PATH_PREFIX}`);

  // DB 侧:全部附件行(带上 issue key,打印时可读)。
  const rows = await sql<{ id: string; url: string; pathname: string; key: string }[]>`
    SELECT a.id, a.url, a.pathname, i.key
    FROM issue_attachments a JOIN issues i ON i.id = a.issue_id
  `;
  const rowByPathname = new Map(rows.map((r) => [r.pathname, r]));

  // Blob 侧:签发前缀下的全部对象(分页拉全)。
  const blobs: { pathname: string; url: string }[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await list({ prefix: ATTACHMENT_PATH_PREFIX, limit: 1000, ...(cursor ? { cursor } : {}) });
    blobs.push(...page.blobs.map((b) => ({ pathname: b.pathname, url: b.url })));
    if (!page.hasMore || !page.cursor) break;
    cursor = page.cursor;
  }
  const blobPathnames = new Set(blobs.map((b) => b.pathname));

  const orphans = blobs.filter((b) => !rowByPathname.has(b.pathname));
  const deadlinks = rows.filter((r) => !blobPathnames.has(r.pathname));

  console.log(`DB 附件行 ${rows.length},blob 对象 ${blobs.length};孤儿 blob ${orphans.length},死链行 ${deadlinks.length}`);
  for (const b of orphans) console.log(`  orphan   ${b.pathname}`);
  for (const r of deadlinks) console.log(`  deadlink ${r.key}  ${r.pathname}`);

  if (!apply) {
    console.log('dry-run — 加 --apply 执行清理');
  } else {
    let blobsDeleted = 0;
    for (const b of orphans) {
      try {
        await del(b.url);
        blobsDeleted += 1;
      } catch (e) {
        console.warn(`  blob 删除失败(下次对账再清): ${b.pathname}`, e);
      }
    }
    let rowsDeleted = 0;
    if (deadlinks.length) {
      const res = await sql`DELETE FROM issue_attachments WHERE id = ANY(${deadlinks.map((r) => r.id)})`;
      rowsDeleted = Number(res.count);
    }
    console.log(`done — 删除孤儿 blob ${blobsDeleted}/${orphans.length},死链行 ${rowsDeleted}`);
  }
  await sql.end();
}

main();
