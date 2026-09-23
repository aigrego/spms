/**
 * 附件对账 (TKT-18 → 2026-09 存储多后端化): 逐公司对照 issue_attachments 表与
 * 其配置的存储后端(company_storage_configs),找出两类漂移 —
 *   - 孤儿对象: 存储里存在(该公司签发前缀 issues/{companyId}/ 下)但 DB 无附件行;
 *   - 死链行:   DB 有附件行但对象已不存在(存储侧被手工清理等)。
 * 无配置的公司跳过(并提示)。object_key 为 NULL 的旧行(平台级 Vercel Blob
 * 时代)仅在提供 BLOB_READ_WRITE_TOKEN 环境变量时对账。
 * 默认 dry-run 只打印,--apply 才实删(孤儿删对象,死链删行;对象删除失败
 * 只告警,下次对账再清)。
 *
 * 用法:
 *   DATABASE_URL=<目标库> CONFIG_CRYPTO_KEY=<hex64> npx tsx scripts/reconcile-attachments.ts           # 预演
 *   DATABASE_URL=<目标库> CONFIG_CRYPTO_KEY=<hex64> npx tsx scripts/reconcile-attachments.ts --apply    # 实删
 *   可选: BLOB_READ_WRITE_TOKEN=<legacy token>  用于对账 object_key 为 NULL 的存量行
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Minio from 'minio';
import postgres from 'postgres';
import { decryptSecret } from '../src/server/crypto';

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

interface CompanyConf {
  companyId: string;
  backend: string;
  endpoint: string | null;
  port: number | null;
  useSsl: boolean;
  accessKeyEnc: string | null;
  secretKeyEnc: string | null;
  bucket: string | null;
  tokenEnc: string | null;
}

interface AttachmentRow {
  id: string;
  companyId: string;
  url: string;
  pathname: string;
  objectKey: string | null;
  key: string; // issue key
}

/** 列出某后端在公司前缀下的全部对象 key。 */
async function listObjects(conf: CompanyConf): Promise<{ keys: Set<string>; urlOf: (k: string) => string }> {
  const prefix = `issues/${conf.companyId}/`;
  if (conf.backend === 'minio') {
    const client = new Minio.Client({
      endPoint: conf.endpoint!,
      port: conf.port ?? (conf.useSsl ? 443 : 9000),
      useSSL: conf.useSsl,
      accessKey: decryptSecret(conf.accessKeyEnc!),
      secretKey: decryptSecret(conf.secretKeyEnc!),
    });
    const keys = new Set<string>();
    const stream = client.listObjectsV2(conf.bucket!, prefix, true);
    await new Promise<void>((res, rej) => {
      stream.on('data', (o) => o.name && keys.add(o.name));
      stream.on('end', res);
      stream.on('error', rej);
    });
    return { keys, urlOf: (k) => k };
  }
  // vercel_blob
  const { list } = await import('@vercel/blob');
  const token = decryptSecret(conf.tokenEnc!);
  const keys = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await list({ prefix, limit: 1000, token, ...(cursor ? { cursor } : {}) });
    for (const b of page.blobs) keys.add(b.pathname);
    if (!page.hasMore || !page.cursor) break;
    cursor = page.cursor;
  }
  return { keys, urlOf: (k) => k };
}

async function delObject(conf: CompanyConf, key: string): Promise<void> {
  if (conf.backend === 'minio') {
    const client = new Minio.Client({
      endPoint: conf.endpoint!,
      port: conf.port ?? (conf.useSsl ? 443 : 9000),
      useSSL: conf.useSsl,
      accessKey: decryptSecret(conf.accessKeyEnc!),
      secretKey: decryptSecret(conf.secretKeyEnc!),
    });
    await client.removeObject(conf.bucket!, key);
    return;
  }
  const { del } = await import('@vercel/blob');
  await del(key, { token: decryptSecret(conf.tokenEnc!) });
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@livebook:5433/spms');
  console.log(`mode: ${apply ? 'APPLY (实删)' : 'DRY-RUN (只列出)'}`);

  const rows = await sql<AttachmentRow[]>`
    SELECT a.id, a.company_id AS "companyId", a.url, a.pathname, a.object_key AS "objectKey", i.key
    FROM issue_attachments a JOIN issues i ON i.id = a.issue_id
  `;
  const confs = await sql<CompanyConf[]>`
    SELECT company_id AS "companyId", backend, endpoint, port, use_ssl AS "useSsl",
           access_key_enc AS "accessKeyEnc", secret_key_enc AS "secretKeyEnc",
           bucket, token_enc AS "tokenEnc"
    FROM company_storage_configs
  `;
  const confByCompany = new Map(confs.map((c) => [c.companyId, c]));

  let totalOrphans = 0;
  let totalDeadlinks = 0;
  const deadlinkIds: string[] = [];

  // 有配置的公司:逐家对账 object_key 行。
  for (const conf of confs) {
    const companyRows = rows.filter((r) => r.companyId === conf.companyId && r.objectKey);
    let keys: Set<string>;
    let urlOf: (k: string) => string;
    try {
      ({ keys, urlOf } = await listObjects(conf));
    } catch (e) {
      console.warn(`公司 ${conf.companyId}(${conf.backend}) 存储不可达,跳过:`, e);
      continue;
    }
    const rowKeys = new Set(companyRows.map((r) => r.objectKey!));
    const orphans = [...keys].filter((k) => !rowKeys.has(k));
    const deadlinks = companyRows.filter((r) => !keys.has(r.objectKey!));
    totalOrphans += orphans.length;
    totalDeadlinks += deadlinks.length;
    console.log(
      `公司 ${conf.companyId}(${conf.backend}): DB 行 ${companyRows.length},对象 ${keys.size};孤儿 ${orphans.length},死链 ${deadlinks.length}`,
    );
    for (const k of orphans) console.log(`  orphan   ${k}`);
    for (const r of deadlinks) console.log(`  deadlink ${r.key}  ${r.objectKey}`);
    deadlinkIds.push(...deadlinks.map((r) => r.id));

    if (apply) {
      let n = 0;
      for (const k of orphans) {
        try {
          await delObject(conf, urlOf(k));
          n += 1;
        } catch (e) {
          console.warn(`  对象删除失败(下次对账再清): ${k}`, e);
        }
      }
      console.log(`  → 删除孤儿对象 ${n}/${orphans.length}`);
    }
  }

  // 无配置公司 / 存量旧行(object_key NULL)。
  const skippedCompanies = new Set(rows.filter((r) => !confByCompany.has(r.companyId)).map((r) => r.companyId));
  for (const c of skippedCompanies) console.log(`公司 ${c} 无存储配置,跳过`);
  const legacy = rows.filter((r) => !r.objectKey);
  if (legacy.length) {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      console.log(`存量旧行(object_key NULL) ${legacy.length} 条;提供 BLOB_READ_WRITE_TOKEN 可对账原平台级 Blob`);
    } else {
      const { list, del } = await import('@vercel/blob');
      const blobs: { pathname: string; url: string }[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await list({ prefix: 'issues/', limit: 1000, token, ...(cursor ? { cursor } : {}) });
        blobs.push(...page.blobs.map((b) => ({ pathname: b.pathname, url: b.url })));
        if (!page.hasMore || !page.cursor) break;
        cursor = page.cursor;
      }
      const blobPaths = new Set(blobs.map((b) => b.pathname));
      const legacyByPath = new Map(legacy.map((r) => [r.pathname, r]));
      const orphans = blobs.filter((b) => !legacyByPath.has(b.pathname));
      const deadlinks = legacy.filter((r) => !blobPaths.has(r.pathname));
      totalOrphans += orphans.length;
      totalDeadlinks += deadlinks.length;
      console.log(`存量 Blob: 对象 ${blobs.length};孤儿 ${orphans.length},死链行 ${deadlinks.length}`);
      for (const b of orphans) console.log(`  orphan   ${b.pathname}`);
      for (const r of deadlinks) console.log(`  deadlink ${r.key}  ${r.pathname}`);
      deadlinkIds.push(...deadlinks.map((r) => r.id));
      if (apply) {
        let n = 0;
        for (const b of orphans) {
          try {
            await del(b.url, { token });
            n += 1;
          } catch (e) {
            console.warn(`  blob 删除失败(下次对账再清): ${b.pathname}`, e);
          }
        }
        console.log(`  → 删除孤儿 blob ${n}/${orphans.length}`);
      }
    }
  }

  console.log(`合计: 孤儿 ${totalOrphans},死链行 ${totalDeadlinks}`);
  if (!apply) {
    console.log('dry-run — 加 --apply 执行清理');
  } else if (deadlinkIds.length) {
    const res = await sql`DELETE FROM issue_attachments WHERE id = ANY(${deadlinkIds})`;
    console.log(`done — 删除死链行 ${Number(res.count)}`);
  }
  await sql.end();
}

main();
