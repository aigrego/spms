/**
 * 附件历史对象迁移(ATTACHMENT-REKEY M4 / TKT-218;计划 §4-P3):把三个时代的
 * 历史附件拷贝到新 key 规则位置并清洗 DB 行地址。新 key 规则:
 *   {companyId}/{category}/{userSegment}/{fileType}/{uuid}-{safeName}
 *   - category 由行的 owner FK 推导(issueId→issues / testCaseId→cases /
 *     requirementId→requirements);
 *   - userSegment = uploadedById ?? 'system'(§0.6;历史 Notion 行落个人目录,
 *     与「Notion 归 system/」的偏差见计划 §0.2-e);
 *   - fileType 由行 contentType 推导(fileTypeOf;脏 contentType 落 others/,
 *     dry-run 报表列样本人工过目,§0.2-f)。
 *
 * 四类源(§4-P3-2,逐行按 objectKey 格式 + 公司配置分类):
 *   NEW_FMT        objectKey 已命中 ^{companyId}/ → 跳过(幂等判定,脚本可反复跑);
 *   LEGACY_SHARED  ^issues/{companyId}/ 且公司行 provisioned='auto' → 同 bucket
 *                  copyObject(受限凭据在双前缀策略窗口内可读旧前缀);
 *   LEGACY_MANUAL  公司行是手动配置,或 --configs-from 快照证明该行 force 重开通
 *                  前是另一套配置 → 用快照(缺省现网)旧凭据建源 client getObject;
 *   VERCEL         object_key IS NULL(平台级 Vercel Blob 时代) → fetch(行.url)
 *                  公网取回。
 * 迁移目标一律为公司当前行的存储后端(正常流程下 = 共享 bucket 的 auto 受限
 * 账号前缀;手动行公司须先 --backup-configs 快照 → 平台管理员 force 重开通转
 * auto → 再跑本脚本,否则 LEGACY_MANUAL 行写入端报「公司行不是 auto」失败)。
 *
 * 安全红线(§6-7):**绝不删源对象、绝不删 DB 行**(本脚本无 removeObject /
 * DELETE FROM);解密后的凭据只进内存,绝不写日志;单行失败记录后继续。
 *
 * 受限凭据(provisioned='auto')建 client 必须 pin region:'us-east-1'——受限
 * 用户无 GetBucketLocation,minio-js 探活被拒会长重试(§10)。
 *
 * 用法(env 加载照抄 reconcile;DATABASE_URL 必填,CONFIG_CRYPTO_KEY 用于解密凭据):
 *   DATABASE_URL=<库> npx tsx scripts/migrate-attachments.ts                        # dry-run 分类报表
 *   ... --probe                  # 附可达性探测(VERCEL: HEAD;MinIO: statObject) → 预计失败清单
 *   ... --backup-configs         # 先快照 company_storage_configs 全行(密文原样)到
 *                                #   data/migration-backups/<ts>.json(force 重开通的硬前置)
 *   ... --configs-from <path>    # LEGACY_MANUAL 源凭据取自指定快照文件
 *   ... --apply                  # 实际迁移(逐行:取回/copyObject → put → UPDATE 行)
 *   ... --limit N | --ids a,b,c  # 只处理子集(试跑用;报表/探测/校验同样限定子集)
 * apply 收尾校验:重扫处理范围,objectKey 不命中新格式的行逐条列出(有则退出码
 * 非零),并对全部新 key 做 statObject 校验。
 */
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as Minio from 'minio';
import { fileTypeOf } from '../src/lib/attachments';
import { decryptSecret } from '../src/server/crypto';
import { minioBackend, type MinioConfig } from '../src/server/storage/minio';
import { newObjectKey, type AttachmentCategory, type StorageBackend } from '../src/server/storage/types';
import { createSql } from './lib/env';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const probe = args.includes('--probe');
const backupConfigs = args.includes('--backup-configs');
const argValue = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const configsFrom = argValue('--configs-from');
const limitArg = Number(argValue('--limit'));
const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.floor(limitArg) : null;
const idsArg = argValue('--ids');
const onlyIds = idsArg ? new Set(idsArg.split(',').map((s) => s.trim()).filter(Boolean)) : null;

/* ---- 数据形状 ---- */

interface CompanyConf {
  companyId: string;
  backend: string;
  endpoint: string | null;
  port: number | null;
  useSsl: boolean;
  accessKeyEnc: string | null;
  secretKeyEnc: string | null;
  bucket: string | null;
  publicBaseUrl: string | null;
  provisioned: string | null; // 'auto' | NULL(手动配置)
}

interface AttachmentRow {
  id: string;
  companyId: string;
  issueId: string | null;
  testCaseId: string | null;
  requirementId: string | null;
  url: string;
  objectKey: string | null;
  filename: string;
  contentType: string;
  uploadedById: string | null;
}

type Cls = 'NEW_FMT' | 'LEGACY_SHARED' | 'LEGACY_MANUAL' | 'VERCEL' | 'NO_CONFIG';

/* 行的 owner FK → key 的 category 段(计划 §2 约定的唯一映射)。 */
const categoryOf = (r: AttachmentRow): AttachmentCategory =>
  r.testCaseId ? 'cases' : r.requirementId ? 'requirements' : 'issues';

const ownerOf = (r: AttachmentRow): string =>
  r.issueId ? `issue ${r.issueId}` : r.testCaseId ? `case ${r.testCaseId}` : `requirement ${r.requirementId}`;

/* ---- 配置行 → MinIO 凭据/client(解密只进内存,不写日志) ---- */

function confToMinio(row: CompanyConf, pinRegion: boolean): MinioConfig | null {
  if (row.backend !== 'minio' || !row.endpoint || !row.accessKeyEnc || !row.secretKeyEnc || !row.bucket) return null;
  return {
    endpoint: row.endpoint,
    port: row.port ?? (row.useSsl ? 443 : 9000),
    useSsl: row.useSsl,
    accessKey: decryptSecret(row.accessKeyEnc),
    secretKey: decryptSecret(row.secretKeyEnc),
    bucket: row.bucket,
    publicBaseUrl: row.publicBaseUrl,
    /* 受限凭据(auto)pin 死签名 region:无 GetBucketLocation 权限,不 pin 会
       卡在 minio-js 的探活重试上(§10)。手动配置行(全权限凭据)不 pin。 */
    ...(pinRegion ? { region: 'us-east-1' } : {}),
  };
}

const rawClient = (c: MinioConfig): Minio.Client =>
  new Minio.Client({
    endPoint: c.endpoint,
    port: c.port,
    useSSL: c.useSsl,
    accessKey: c.accessKey,
    secretKey: c.secretKey,
    ...(c.region ? { region: c.region } : {}),
  });

/* 写入端:公司当前行的 backend(put 只认新格式 key;canonicalUrl 复用存储层
   minioBackend 的逻辑,公网基址规范化与运行时任一时候签发的 url 逐字节一致)。 */
function targetBackend(row: CompanyConf): StorageBackend {
  const conf = confToMinio(row, row.provisioned === 'auto');
  if (!conf) throw new Error(`公司 ${row.companyId} 存储配置不完整(backend=${row.backend})`);
  return minioBackend(row.companyId, conf);
}

/* ---- 分类(§4-P3-2) ---- */

function classify(row: AttachmentRow, live: CompanyConf | undefined, snap: CompanyConf | undefined): Cls {
  if (row.objectKey?.startsWith(`${row.companyId}/`)) return 'NEW_FMT';
  if (!row.objectKey) return 'VERCEL';
  if (!live) return 'NO_CONFIG';
  // 快照与现网配置不一致 = 该行在快照后被 force 重开通过:旧对象要用快照里的
  // 旧凭据取回,即使现网行已是 auto(此时同 bucket copyObject 多半也不成立,
  // 因为旧对象可能在另一 endpoint/bucket 下)。
  const snapDiverged =
    !!snap &&
    (snap.endpoint !== live.endpoint || snap.bucket !== live.bucket || snap.accessKeyEnc !== live.accessKeyEnc);
  if (live.provisioned !== 'auto' || snapDiverged) return 'LEGACY_MANUAL';
  if (row.objectKey.startsWith(`issues/${row.companyId}/`)) return 'LEGACY_SHARED';
  // objectKey 既非新格式也非 legacy 前缀(脏数据):按 LEGACY_MANUAL 用现网凭据
  // getObject 尝试,失败计入单行失败。
  return 'LEGACY_MANUAL';
}

/* ---- 取回源字节(LEGACY_MANUAL/VERCEL)或同桶拷贝(LEGACY_SHARED) ---- */

async function fetchSourceBytes(cls: 'LEGACY_MANUAL' | 'VERCEL', row: AttachmentRow, srcClient: Minio.Client | null, srcBucket: string | null): Promise<Buffer> {
  if (cls === 'VERCEL') {
    const res = await fetch(row.url);
    if (!res.ok) throw new Error(`公网取回失败 HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (!srcClient || !srcBucket) throw new Error('LEGACY_MANUAL 源凭据缺失(需要 --configs-from 快照或现网手动配置行)');
  const stream = await srcClient.getObject(srcBucket, row.objectKey!);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/* ---- main ---- */

async function main() {
  const sql = createSql();
  console.log(
    `mode: ${apply ? 'APPLY (拷贝+改行,绝不删源)' : 'DRY-RUN'}${probe ? ' + PROBE' : ''}${limit ? ` --limit ${limit}` : ''}${onlyIds ? ` --ids ${onlyIds.size} 条` : ''}`,
  );

  /* ① --backup-configs:全行密文原样快照(任何 force 重开通之前的硬前置)。 */
  if (backupConfigs) {
    const rows = await sql`SELECT * FROM company_storage_configs ORDER BY company_id`;
    const dir = resolve(process.cwd(), 'data/migration-backups');
    await mkdir(dir, { recursive: true });
    const file = resolve(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(file, JSON.stringify(rows, null, 2));
    console.log(`备份快照(密文原样,不解密不写日志) → ${file} (${rows.length} 行)`);
  }

  /* ② 现网公司配置 + 可选快照。 */
  const confs = await sql<CompanyConf[]>`
    SELECT company_id AS "companyId", backend, endpoint, port, use_ssl AS "useSsl",
           access_key_enc AS "accessKeyEnc", secret_key_enc AS "secretKeyEnc", bucket,
           public_base_url AS "publicBaseUrl", provisioned
    FROM company_storage_configs
  `;
  const liveByCompany = new Map(confs.map((c) => [c.companyId, c]));
  let snapByCompany = new Map<string, CompanyConf>();
  if (configsFrom) {
    const snapRows = JSON.parse(readFileSync(resolve(process.cwd(), configsFrom), 'utf8')) as Record<string, unknown>[];
    snapByCompany = new Map(
      snapRows.map((r) => [
        String(r.company_id ?? r.companyId),
        {
          companyId: String(r.company_id ?? r.companyId),
          backend: String(r.backend),
          endpoint: (r.endpoint as string) ?? null,
          port: (r.port as number) ?? null,
          useSsl: Boolean(r.use_ssl ?? r.useSsl),
          accessKeyEnc: (r.access_key_enc ?? r.accessKeyEnc) as string | null,
          secretKeyEnc: (r.secret_key_enc ?? r.secretKeyEnc) as string | null,
          bucket: (r.bucket as string) ?? null,
          publicBaseUrl: (r.public_base_url ?? r.publicBaseUrl) as string | null,
          provisioned: (r.provisioned as string) ?? null,
        },
      ]),
    );
    console.log(`LEGACY_MANUAL 源凭据快照 ← ${configsFrom} (${snapByCompany.size} 行)`);
  }

  /* ③ 取行并按四类分类(幂等:NEW_FMT 直接跳过)。 */
  const allRows = await sql<AttachmentRow[]>`
    SELECT id, company_id AS "companyId", issue_id AS "issueId", test_case_id AS "testCaseId",
           requirement_id AS "requirementId", url, object_key AS "objectKey",
           filename, content_type AS "contentType", uploaded_by_id AS "uploadedById"
    FROM attachments ORDER BY created_at
  `;
  const rows: AttachmentRow[] = onlyIds ? allRows.filter((r) => onlyIds.has(r.id)) : allRows;
  const classified = rows.map((r) => ({ row: r, cls: classify(r, liveByCompany.get(r.companyId), snapByCompany.get(r.companyId)) }));
  const todoAll = classified.filter((c) => c.cls !== 'NEW_FMT');
  const todo = limit ? todoAll.slice(0, limit) : todoAll;
  console.log(`全表 ${rows.length} 行;NEW_FMT 跳过 ${classified.length - todoAll.length};待迁移 ${todoAll.length}${todo.length !== todoAll.length ? `(本次子集 ${todo.length})` : ''}`);

  /* dry-run 报表:逐公司逐类计数 + others/ 样本。 */
  const byCompany = new Map<string, Map<Cls, number>>();
  for (const { row, cls } of todo) {
    if (!byCompany.has(row.companyId)) byCompany.set(row.companyId, new Map());
    const m = byCompany.get(row.companyId)!;
    m.set(cls, (m.get(cls) ?? 0) + 1);
  }
  for (const [cid, m] of byCompany) {
    const live = liveByCompany.get(cid);
    const tag = live ? (live.provisioned === 'auto' ? 'auto' : '手动配置') : '无存储配置';
    const counts = (['LEGACY_SHARED', 'LEGACY_MANUAL', 'VERCEL', 'NO_CONFIG'] as Cls[])
      .filter((c) => m.get(c))
      .map((c) => `${c}=${m.get(c)}`)
      .join(' ');
    console.log(`公司 ${cid} (${tag}): ${counts}`);
  }
  const others = todo.filter(({ row }) => fileTypeOf(row.contentType) === 'others');
  if (others.length) {
    console.log(`将落 others/ 的行 ${others.length} 条(contentType 不在 images/documents 映射内),样本:`);
    for (const { row } of others.slice(0, 20)) console.log(`  others  ${row.id}  ${row.filename}  (${row.contentType})`);
  }

  /* ④ --probe 可达性探测 → 预计失败清单。 */
  const expectedFail: { id: string; cls: Cls; reason: string }[] = [];
  if (probe) {
    for (const { row, cls } of todo) {
      try {
        if (cls === 'VERCEL') {
          let res = await fetch(row.url, { method: 'HEAD' });
          if (res.status === 405) res = await fetch(row.url, { method: 'GET' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } else if (cls === 'LEGACY_SHARED') {
          const live = liveByCompany.get(row.companyId)!;
          const conf = confToMinio(live, true);
          if (!conf) throw new Error('公司存储配置不完整');
          await rawClient(conf).statObject(conf.bucket, row.objectKey!);
        } else if (cls === 'LEGACY_MANUAL') {
          const snap = snapByCompany.get(row.companyId) ?? liveByCompany.get(row.companyId);
          const conf = snap ? confToMinio(snap, false) : null;
          if (!conf) throw new Error('源凭据缺失(需要 --configs-from 快照)');
          await rawClient(conf).statObject(conf.bucket, row.objectKey!);
        } else if (cls === 'NO_CONFIG') {
          throw new Error('公司无存储配置行,无法取回也无法写入');
        }
      } catch (e) {
        expectedFail.push({ id: row.id, cls, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    console.log(`probe: 可达 ${todo.length - expectedFail.length},预计失败 ${expectedFail.length}`);
    for (const f of expectedFail) console.log(`  预计失败 ${f.id}  ${f.cls}  ${f.reason}`);
  }

  if (!apply) {
    console.log('dry-run — 加 --apply 执行迁移(绝不删源对象/DB 行)');
    await sql.end();
    return;
  }

  /* ⑤ apply:逐行 取回/copyObject → 新 key put → UPDATE 行。单行失败继续。 */
  const failures: { id: string; error: string }[] = [];
  const written: { id: string; companyId: string; newKey: string; bucket: string; client: Minio.Client }[] = [];
  const targetCache = new Map<string, { backend: StorageBackend; client: Minio.Client; bucket: string }>();
  const targetFor = (cid: string) => {
    if (!targetCache.has(cid)) {
      const live = liveByCompany.get(cid);
      if (!live) throw new Error(`公司 ${cid} 无存储配置行`);
      if (live.provisioned !== 'auto') {
        throw new Error(`公司 ${cid} 行不是 provisioned='auto'(手动行公司须先 --backup-configs 快照并 force 重开通转 auto 再迁移)`);
      }
      const backend = targetBackend(live);
      const conf = confToMinio(live, true)!;
      targetCache.set(cid, { backend, client: rawClient(conf), bucket: conf.bucket });
    }
    return targetCache.get(cid)!;
  };

  for (const { row, cls } of todo) {
    try {
      if (cls === 'NEW_FMT') continue;
      const target = targetFor(row.companyId);
      const newKey = newObjectKey(row.companyId, categoryOf(row), row.uploadedById ?? 'system', fileTypeOf(row.contentType), row.filename);
      if (cls === 'LEGACY_SHARED') {
        // 同 bucket 服务端拷贝,字节不落盘;源对象保留不动。
        await target.client.copyObject(target.bucket, newKey, `${target.bucket}/${row.objectKey}`, new Minio.CopyConditions());
      } else {
        const snap = snapByCompany.get(row.companyId);
        const srcConf = cls === 'LEGACY_MANUAL' ? confToMinio(snap ?? liveByCompany.get(row.companyId)!, false) : null;
        const bytes = await fetchSourceBytes(cls as 'LEGACY_MANUAL' | 'VERCEL', row, srcConf ? rawClient(srcConf) : null, srcConf?.bucket ?? null);
        await target.backend.put(newKey, bytes, row.contentType);
      }
      const canonical = target.backend.canonicalUrl(newKey);
      await sql`
        UPDATE attachments SET url = ${canonical}, object_key = ${newKey}
        WHERE id = ${row.id}
      `;
      written.push({ id: row.id, companyId: row.companyId, newKey, bucket: target.bucket, client: target.client });
      console.log(`ok    ${row.id}  ${ownerOf(row)}  ${cls} → ${newKey}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push({ id: row.id, error: msg });
      console.error(`FAIL  ${row.id}  ${cls}  ${msg}`);
    }
  }

  /* ⑥ 收尾校验:处理范围内重扫,objectKey 不命中新格式的行逐条列出;
     全部新 key statObject 校验可达。 */
  const scopeIds = todo.map((t) => t.row.id);
  let unmigrated: AttachmentRow[] = [];
  if (scopeIds.length) {
    unmigrated = await sql<AttachmentRow[]>`
      SELECT id, company_id AS "companyId", issue_id AS "issueId", test_case_id AS "testCaseId",
             requirement_id AS "requirementId", url, object_key AS "objectKey",
             filename, content_type AS "contentType", uploaded_by_id AS "uploadedById"
      FROM attachments
      WHERE id = ANY(${scopeIds}) AND (object_key IS NULL OR object_key NOT LIKE company_id || '/%')
    `;
  }
  let statFail = 0;
  for (const w of written) {
    try {
      await w.client.statObject(w.bucket, w.newKey);
    } catch (e) {
      statFail += 1;
      console.error(`STAT-FAIL ${w.newKey}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const [{ remaining }] = await sql<[{ remaining: number }]>`
    SELECT count(*)::int AS remaining FROM attachments WHERE object_key IS NULL OR object_key NOT LIKE company_id || '/%'
  `;
  console.log(`合计: 迁移成功 ${written.length},失败 ${failures.length},新 key 校验失败 ${statFail};全库未迁移余量 ${remaining}`);
  for (const f of failures) console.log(`  FAILED ${f.id}: ${f.error}`);
  for (const r of unmigrated) console.log(`  未迁移 ${r.id}  ${ownerOf(r)}  objectKey=${r.objectKey ?? 'NULL'}`);
  await sql.end();
  if (failures.length || unmigrated.length || statFail) process.exit(1);
}

main();
