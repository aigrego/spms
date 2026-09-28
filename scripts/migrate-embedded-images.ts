/**
 * 正文内嵌存储 URL 迁移(ATTACHMENT-REKEY 二期遗留根修的存量部分):把评论/
 * 描述等文本字段里直接内嵌的 Vercel Blob 公网 URL(及指向旧 bucket 的
 * s3 直连 URL)取回字节、按新 key 规则写入该公司当前存储后端,并把正文中的
 * URL 改写为应用内读取代理地址 /api/v1/pms/attachments/object?key=<objectKey>
 * (与 lib/upload.ts objectReadUrl 一致;粘贴图不注册附件行,key 前缀即归属
 * 证明,代理 ?key= 分支强制 companyId 匹配)。
 *
 * 源分类(逐 URL):
 *   VERCEL      *.public.blob.vercel-storage.com → fetch 公网取回;
 *   S3_DIRECT   host == 公司/平台当前 endpoint(如 s3.innev.cn)→ 路径首段为
 *               bucket、其余为 key,用平台凭据 getObject 取回(覆盖 gen-x 等
 *               旧 bucket;平台凭据在共享 MinIO 上有跨 bucket 读权限)。
 *
 * key 规则与 migrate-attachments.ts 一致:{companyId}/{category}/{userSegment}/
 * {fileType}/{uuid}-{safeName};category 由所在表推导(activities/issues→issues,
 * requirements→requirements,test_cases→cases),userSegment 取行作者 member id
 * (activities.who_id),无作者概念的表落 system。
 *
 * 安全红线(同 migrate-attachments):**绝不删源对象、绝不整行覆盖**——只对本
 * 脚本识别出的 URL 做精确字符串替换;解密凭据只进内存;单 URL 失败记录后继续,
 * 该 URL 在正文中保持原样。幂等:改写后的代理地址是相对路径,不再命中扫描
 * 正则,脚本可反复跑。
 *
 * 用法(env 经 scripts/lib/env 共享模块加载;DATABASE_URL 必填,CONFIG_CRYPTO_KEY
 * 用于解密凭据):
 *   npx tsx scripts/migrate-embedded-images.ts           # dry-run 报表
 *   npx tsx scripts/migrate-embedded-images.ts --probe   # 附 URL 可达性探测
 *   npx tsx scripts/migrate-embedded-images.ts --apply   # 实际迁移+改写正文
 */
import * as Minio from 'minio';
import { fileTypeOf } from '../src/lib/attachments';
import { decryptSecret } from '../src/server/crypto';
import { minioBackend, type MinioConfig } from '../src/server/storage/minio';
import { newObjectKey, type AttachmentCategory, type StorageBackend } from '../src/server/storage/types';
import { createSql } from './lib/env';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const probe = args.includes('--probe');

/* ---- 扫描目标:表/文本列 → category 与作者列 ---- */

interface Target {
  table: string;
  col: string;
  category: AttachmentCategory;
  authorCol?: string; // member id 列;缺省落 system
}

const TARGETS: Target[] = [
  { table: 'activities', col: 'body', category: 'issues', authorCol: 'who_id' },
  { table: 'issues', col: 'description', category: 'issues' },
  { table: 'requirements', col: 'description', category: 'requirements' },
  { table: 'requirements', col: 'acceptance_criteria', category: 'requirements' },
  { table: 'test_cases', col: 'steps', category: 'cases' },
  { table: 'test_cases', col: 'expected', category: 'cases' },
  { table: 'test_cases', col: 'preconditions', category: 'cases' },
  { table: 'plans', col: 'content', category: 'requirements' },
  { table: 'daily_report_entries', col: 'content', category: 'issues' },
];

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
  provisioned: string | null;
}

interface Hit {
  target: Target;
  rowId: string;
  companyId: string;
  authorId: string | null;
  url: string;
}

type Cls = 'VERCEL' | 'S3_DIRECT';

const VERCEL_RE = /https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/[^\s)"'<>\\]+/gi;

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

/* 正文里的 s3 直连 URL → { bucket, key };host 不匹配返回 null。 */
function parseS3Url(url: string, hosts: Set<string>): { bucket: string; key: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!hosts.has(u.hostname)) return null;
  const segs = u.pathname.replace(/^\//, '').split('/');
  if (segs.length < 2 || !segs[0] || !segs[1]) return null;
  return { bucket: segs[0], key: decodeURIComponent(segs.slice(1).join('/')) };
}

function filenameOf(url: string): string {
  try {
    const base = new URL(url).pathname.split('/').pop() ?? '';
    return decodeURIComponent(base) || 'image.png';
  } catch {
    return 'image.png';
  }
}

async function main() {
  const sql = createSql();
  console.log(`mode: ${apply ? 'APPLY (取回+写新 key+改写正文,绝不删源)' : 'DRY-RUN'}${probe ? ' + PROBE' : ''}`);

  /* 公司配置 + 平台配置(s3 直连 URL 的取回凭据)。 */
  const confs = await sql<CompanyConf[]>`
    SELECT company_id AS "companyId", backend, endpoint, port, use_ssl AS "useSsl",
           access_key_enc AS "accessKeyEnc", secret_key_enc AS "secretKeyEnc", bucket,
           public_base_url AS "publicBaseUrl", provisioned
    FROM company_storage_configs
  `;
  const liveByCompany = new Map(confs.map((c) => [c.companyId, c]));
  const [plat] = await sql<CompanyConf[]>`
    SELECT 'platform' AS "companyId", backend, endpoint, port, use_ssl AS "useSsl",
           access_key_enc AS "accessKeyEnc", secret_key_enc AS "secretKeyEnc", bucket,
           public_base_url AS "publicBaseUrl", NULL AS provisioned
    FROM platform_storage_configs WHERE id = 'default'
  `;
  const s3Hosts = new Set<string>();
  for (const c of [...confs, ...(plat ? [plat] : [])]) {
    if (c.endpoint) s3Hosts.add(c.endpoint);
    if (c.publicBaseUrl) {
      try {
        s3Hosts.add(new URL(c.publicBaseUrl).hostname);
      } catch { /* ignore */ }
    }
  }

  /* ① 扫描全部目标列,收集命中(URL 去重前的逐处出现)。 */
  const hits: Hit[] = [];
  for (const t of TARGETS) {
    const rows = await sql.unsafe<{ id: string; company_id: string; author: string | null; body: string }[]>(
      `SELECT id, company_id, ${t.authorCol ? `${t.authorCol} AS author,` : 'NULL AS author,'} ${t.col} AS body
       FROM ${t.table} WHERE ${t.col} ~* '(public\\.blob\\.vercel-storage\\.com|${[...s3Hosts].map((h) => h.replace(/\./g, '\\.')).join('|')})'`,
    );
    for (const r of rows) {
      const urls = new Set<string>();
      for (const m of r.body.matchAll(VERCEL_RE)) urls.add(m[0]);
      if (s3Hosts.size) {
        const hostAlt = [...s3Hosts].map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        const s3Re = new RegExp(`https?://(?:${hostAlt})/[^\\s)"'<>\\\\]+`, 'gi');
        for (const m of r.body.matchAll(s3Re)) urls.add(m[0]);
      }
      for (const url of urls) {
        hits.push({ target: t, rowId: r.id, companyId: r.company_id, authorId: r.author, url });
      }
    }
  }
  const uniqueUrls = [...new Map(hits.map((h) => [`${h.companyId}|${h.url}`, h])).values()];
  console.log(`命中 ${hits.length} 处(去重 URL ${uniqueUrls.length} 个),分布在 ${new Set(hits.map((h) => `${h.target.table}.${h.target.col}`)).size} 个列`);
  const byCol = new Map<string, number>();
  for (const h of hits) byCol.set(`${h.target.table}.${h.target.col}`, (byCol.get(`${h.target.table}.${h.target.col}`) ?? 0) + 1);
  for (const [k, n] of byCol) console.log(`  ${k}: ${n} 处`);

  if (!hits.length) {
    console.log('无内嵌存储 URL,无需迁移');
    await sql.end();
    return;
  }

  /* ② 分类 + 取回字节(逐 URL 一次,多处引用复用)。 */
  const platConf = plat ? confToMinio(plat, false) : null;
  const platClient = platConf ? rawClient(platConf) : null;
  const fetched = new Map<string, { bytes: Buffer; contentType: string }>();
  const fetchFailures = new Map<string, string>();
  for (const h of uniqueUrls) {
    const cacheKey = `${h.companyId}|${h.url}`;
    try {
      const s3 = parseS3Url(h.url, s3Hosts);
      const cls: Cls = s3 ? 'S3_DIRECT' : 'VERCEL';
      if (!s3) {
        const res = await fetch(h.url);
        if (!res.ok) throw new Error(`公网取回失败 HTTP ${res.status}`);
        fetched.set(cacheKey, {
          bytes: Buffer.from(await res.arrayBuffer()),
          contentType: res.headers.get('content-type') ?? 'application/octet-stream',
        });
      } else {
        if (!platClient || !platConf) throw new Error('无平台存储配置,无法取回 s3 直连 URL');
        const stream = await platClient.getObject(s3.bucket, s3.key);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        const stat = await platClient.statObject(s3.bucket, s3.key);
        fetched.set(cacheKey, {
          bytes: Buffer.concat(chunks),
          contentType: (stat.metaData?.['content-type'] as string) ?? 'application/octet-stream',
        });
      }
      if (probe) console.log(`  ok     ${cls} ${h.url} (${fetched.get(cacheKey)!.bytes.length}B)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      fetchFailures.set(cacheKey, msg);
      console.error(`  取回失败 ${h.url}: ${msg}`);
    }
  }
  console.log(`取回: 成功 ${fetched.size},失败 ${fetchFailures.size}`);

  if (!apply) {
    console.log('dry-run — 加 --apply 执行迁移(绝不删源对象,正文只精确替换命中 URL)');
    await sql.end();
    return;
  }

  /* ③ 写入公司当前后端并改写正文(逐行一次 UPDATE,替换该行全部已取回 URL)。 */
  const targetCache = new Map<string, StorageBackend>();
  const targetFor = (cid: string): StorageBackend => {
    if (!targetCache.has(cid)) {
      const live = liveByCompany.get(cid);
      if (!live) throw new Error(`公司 ${cid} 无存储配置行`);
      if (live.provisioned !== 'auto') throw new Error(`公司 ${cid} 行不是 provisioned='auto'`);
      const conf = confToMinio(live, true);
      if (!conf) throw new Error(`公司 ${cid} 存储配置不完整`);
      targetCache.set(cid, minioBackend(cid, conf));
    }
    return targetCache.get(cid)!;
  };

  const newUrlByCacheKey = new Map<string, string>();
  const putFailures = new Map<string, string>();
  for (const h of uniqueUrls) {
    const cacheKey = `${h.companyId}|${h.url}`;
    const f = fetched.get(cacheKey);
    if (!f) continue;
    try {
      const backend = targetFor(h.companyId);
      const newKey = newObjectKey(
        h.companyId,
        h.target.category,
        h.authorId ?? 'system',
        fileTypeOf(f.contentType),
        filenameOf(h.url),
      );
      await backend.put(newKey, f.bytes, f.contentType);
      newUrlByCacheKey.set(cacheKey, `/api/v1/pms/attachments/object?key=${encodeURIComponent(newKey)}`);
      console.log(`  put ok ${newKey} ← ${h.url}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      putFailures.set(cacheKey, msg);
      console.error(`  put 失败 ${h.url}: ${msg}`);
    }
  }

  /* 按行聚合替换。 */
  const byRow = new Map<string, { target: Target; companyId: string; repl: [string, string][] }>();
  for (const h of hits) {
    const newUrl = newUrlByCacheKey.get(`${h.companyId}|${h.url}`);
    if (!newUrl) continue; // 取回/写入失败的 URL 保持原样
    const k = `${h.target.table}|${h.target.col}|${h.rowId}`;
    if (!byRow.has(k)) byRow.set(k, { target: h.target, companyId: h.companyId, repl: [] });
    byRow.get(k)!.repl.push([h.url, newUrl]);
  }
  let updatedRows = 0;
  const updateFailures: { key: string; error: string }[] = [];
  for (const [k, v] of byRow) {
    try {
      const [{ body }] = await sql.unsafe<{ body: string }[]>(
        `SELECT ${v.target.col} AS body FROM ${v.target.table} WHERE id = $1`,
        [k.split('|')[2]],
      );
      let next = body;
      for (const [oldUrl, newUrl] of v.repl) next = next.split(oldUrl).join(newUrl);
      await sql.unsafe(`UPDATE ${v.target.table} SET ${v.target.col} = $1 WHERE id = $2`, [next, k.split('|')[2]]);
      updatedRows += 1;
    } catch (e) {
      updateFailures.push({ key: k, error: e instanceof Error ? e.message : String(e) });
      console.error(`  行更新失败 ${k}: ${updateFailures[updateFailures.length - 1].error}`);
    }
  }

  /* ④ 收尾校验:重扫全部目标列,残留命中逐条列出;新 key 抽样 statObject。 */
  let remaining = 0;
  for (const t of TARGETS) {
    const rows = await sql.unsafe<{ id: string }[]>(
      `SELECT id FROM ${t.table} WHERE ${t.col} ~* '(public\\.blob\\.vercel-storage\\.com|${[...s3Hosts].map((h) => h.replace(/\./g, '\\.')).join('|')})'`,
    );
    remaining += rows.length;
    for (const r of rows) console.log(`  残留 ${t.table}.${t.col} 行 ${r.id}`);
  }
  console.log(
    `合计: URL 写入 ${newUrlByCacheKey.size},取回失败 ${fetchFailures.size},put 失败 ${putFailures.size},行更新 ${updatedRows} 成功/${updateFailures.length} 失败;正文残留命中行 ${remaining}`,
  );
  await sql.end();
  if (fetchFailures.size || putFailures.size || updateFailures.length || remaining) process.exit(1);
}

main();
