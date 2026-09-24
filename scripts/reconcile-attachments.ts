/**
 * 附件对账 (TKT-18;TKT-213 后收敛为平台级 MinIO 唯一后端): 逐公司对照
 * issue_attachments 表与其公司隔离 MinIO 账号(company_storage_configs),找出两类漂移 —
 *   - 孤儿对象: 存储里存在(该公司签发前缀 issues/{companyId}/ 下)但 DB 无附件行;
 *   - 死链行:   DB 有附件行但对象已不存在(存储侧被手工清理等)。
 * 无配置的公司跳过(并提示)。
 *
 * object_key 为 NULL 的存量行(平台级 Vercel Blob 时代)不再对账:@vercel/blob
 * 已随后端收敛移除,无法再 list/del 远端对象;这些行仅为 302 只读兼容保留
 * (读取代理直接跳其存量公网 url)。此类行若需清理,只删 DB 行、绝不触碰远端
 * 对象(无 SDK 可操作;遗留对象由运维在 Vercel 侧自行处理)。
 *
 * 默认 dry-run 只打印,--apply 才实删(孤儿删对象,死链删行;对象删除失败
 * 只告警,下次对账再清)。
 *
 * 用法:
 *   DATABASE_URL=<目标库> CONFIG_CRYPTO_KEY=<hex64> npx tsx scripts/reconcile-attachments.ts           # 预演
 *   DATABASE_URL=<目标库> CONFIG_CRYPTO_KEY=<hex64> npx tsx scripts/reconcile-attachments.ts --apply    # 实删
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
}

interface AttachmentRow {
  id: string;
  companyId: string;
  objectKey: string | null;
  key: string; // issue key
}

function minioClient(conf: CompanyConf): Minio.Client {
  return new Minio.Client({
    endPoint: conf.endpoint!,
    port: conf.port ?? (conf.useSsl ? 443 : 9000),
    useSSL: conf.useSsl,
    accessKey: decryptSecret(conf.accessKeyEnc!),
    secretKey: decryptSecret(conf.secretKeyEnc!),
  });
}

/** 列出某公司签发前缀(issues/{companyId}/)下的全部对象 key。 */
async function listObjects(conf: CompanyConf): Promise<Set<string>> {
  const keys = new Set<string>();
  const stream = minioClient(conf).listObjectsV2(conf.bucket!, `issues/${conf.companyId}/`, true);
  await new Promise<void>((res, rej) => {
    stream.on('data', (o) => o.name && keys.add(o.name));
    stream.on('end', res);
    stream.on('error', rej);
  });
  return keys;
}

async function delObject(conf: CompanyConf, key: string): Promise<void> {
  await minioClient(conf).removeObject(conf.bucket!, key);
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@livebook:5433/spms');
  console.log(`mode: ${apply ? 'APPLY (实删)' : 'DRY-RUN (只列出)'}`);

  const rows = await sql<AttachmentRow[]>`
    SELECT a.id, a.company_id AS "companyId", a.object_key AS "objectKey", i.key
    FROM issue_attachments a JOIN issues i ON i.id = a.issue_id
  `;
  const confs = await sql<CompanyConf[]>`
    SELECT company_id AS "companyId", backend, endpoint, port, use_ssl AS "useSsl",
           access_key_enc AS "accessKeyEnc", secret_key_enc AS "secretKeyEnc", bucket
    FROM company_storage_configs
  `;
  const confByCompany = new Map(confs.map((c) => [c.companyId, c]));

  let totalOrphans = 0;
  let totalDeadlinks = 0;
  const deadlinkIds: string[] = [];

  // 有配置的公司:逐家对账 object_key 行。
  for (const conf of confs) {
    // vercel_blob 后端已移除(TKT-213):历史遗留行无法对账,跳过。
    if (conf.backend !== 'minio') {
      console.log(`公司 ${conf.companyId} 后端 ${conf.backend} 已不支持,跳过`);
      continue;
    }
    const companyRows = rows.filter((r) => r.companyId === conf.companyId && r.objectKey);
    let keys: Set<string>;
    try {
      keys = await listObjects(conf);
    } catch (e) {
      console.warn(`公司 ${conf.companyId} 存储不可达,跳过:`, e);
      continue;
    }
    const rowKeys = new Set(companyRows.map((r) => r.objectKey!));
    const orphans = [...keys].filter((k) => !rowKeys.has(k));
    const deadlinks = companyRows.filter((r) => !keys.has(r.objectKey!));
    totalOrphans += orphans.length;
    totalDeadlinks += deadlinks.length;
    console.log(
      `公司 ${conf.companyId}: DB 行 ${companyRows.length},对象 ${keys.size};孤儿 ${orphans.length},死链 ${deadlinks.length}`,
    );
    for (const k of orphans) console.log(`  orphan   ${k}`);
    for (const r of deadlinks) console.log(`  deadlink ${r.key}  ${r.objectKey}`);
    deadlinkIds.push(...deadlinks.map((r) => r.id));

    if (apply) {
      let n = 0;
      for (const k of orphans) {
        try {
          await delObject(conf, k);
          n += 1;
        } catch (e) {
          console.warn(`  对象删除失败(下次对账再清): ${k}`, e);
        }
      }
      console.log(`  → 删除孤儿对象 ${n}/${orphans.length}`);
    }
  }

  // 无配置公司 / 存量旧行(object_key NULL,平台级 Vercel Blob 时代)。
  const skippedCompanies = new Set(rows.filter((r) => !confByCompany.has(r.companyId)).map((r) => r.companyId));
  for (const c of skippedCompanies) console.log(`公司 ${c} 无存储配置,跳过`);
  const legacy = rows.filter((r) => !r.objectKey);
  // 存量旧行不再对账(见文件头):@vercel/blob 已移除,列不了远端;行本身为
  // 302 只读兼容保留。此类行若需清理,只删 DB 行、不触碰远端对象。
  if (legacy.length) console.log(`存量旧行(object_key NULL) ${legacy.length} 条,跳过对账(详见文件头注释)`);

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
