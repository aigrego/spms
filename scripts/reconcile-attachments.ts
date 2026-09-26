/**
 * 附件对账 (TKT-18;TKT-213 后收敛为平台级 MinIO 唯一后端;ATTACHMENT-REKEY
 * M4 起切到新 key 前缀与泛化表): 逐公司对照 attachments 表与其公司隔离
 * MinIO 账号(company_storage_configs),找出两类漂移 —
 *   - 孤儿对象: 存储里存在(该公司前缀 {companyId}/ 下)但 DB 无附件行;
 *   - 死链行:   DB 有附件行但对象已不存在(存储侧被手工清理等)。
 * 无配置的公司跳过(并提示)。
 *
 * M4 语义变化:
 *   - list 前缀从 legacy `issues/{companyId}/` 切到 `{companyId}/`;旧前缀
 *     对象天然不可见——不误报孤儿,也绝不替用户删旧前缀对象(旧对象由用户
 *     确认迁移全绿后手动删,见 docs/plans/ATTACHMENT-REKEY.md §7.3);
 *   - DB 侧不再 join issues:attachments 三 FK(issue_id/test_case_id/
 *     requirement_id)恰一非空,按归属实体分列统计;
 *   - **警告:迁移脚本(migrate-attachments.ts)apply 完成前,不要对本表
 *     --apply**——迁移窗口内 DB 行还是旧 key、前缀已切,全部存量行都会被
 *     误判死链。
 *   - **粘贴图护栏**:评论粘贴图从未注册为附件行(既有缺陷,见计划 §10-P0),
 *     会被判为孤儿;--min-age-days(默认 7)跳过最近 N 天内新建的对象不删,
 *     防止刚粘贴的图被误删。根修(粘贴图注册化)另立项。
 *
 * object_key 为 NULL 的存量行(平台级 Vercel Blob 时代)不再对账:@vercel/blob
 * 已随后端收敛移除,无法再 list/del 远端对象;这些行仅为 302 只读兼容保留
 * (读取代理直接跳其存量公网 url)。VERCEL 死链只报告不处置;此类行若需清理,
 * 由人确认后手动删 DB 行、绝不触碰远端对象(无 SDK 可操作;遗留对象由运维在
 * Vercel 侧自行处理)。
 *
 * 默认 dry-run 只打印,--apply 才实删(孤儿删对象,死链删行;对象删除失败
 * 只告警,下次对账再清)。
 *
 * 用法:
 *   DATABASE_URL=<目标库> CONFIG_CRYPTO_KEY=<hex64> npx tsx scripts/reconcile-attachments.ts                      # 预演
 *   DATABASE_URL=<目标库> CONFIG_CRYPTO_KEY=<hex64> npx tsx scripts/reconcile-attachments.ts --apply                 # 实删
 *   DATABASE_URL=<目标库> CONFIG_CRYPTO_KEY=<hex64> npx tsx scripts/reconcile-attachments.ts --min-age-days=3        # 收窄粘贴图护栏
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
const ageArg = process.argv.find((a) => a.startsWith('--min-age-days='));
/* 粘贴图护栏:创建时间不足 N 天的未注册对象跳过不删(默认 7 天;0 = 关闭护栏)。 */
const minAgeDays = ageArg ? Number(ageArg.split('=')[1]) : 7;
if (!Number.isFinite(minAgeDays) || minAgeDays < 0) {
  console.error('--min-age-days 需要非负数字');
  process.exit(2);
}

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
  issueId: string | null;
  testCaseId: string | null;
  requirementId: string | null;
}

const ownerOf = (r: AttachmentRow): string =>
  r.issueId ? `issue ${r.issueId}` : r.testCaseId ? `case ${r.testCaseId}` : `requirement ${r.requirementId}`;

function minioClient(conf: CompanyConf): Minio.Client {
  return new Minio.Client({
    endPoint: conf.endpoint!,
    port: conf.port ?? (conf.useSsl ? 443 : 9000),
    useSSL: conf.useSsl,
    accessKey: decryptSecret(conf.accessKeyEnc!),
    secretKey: decryptSecret(conf.secretKeyEnc!),
  });
}

/** 列出某公司前缀 {companyId}/ 下的全部对象 key 及其 lastModified。
 *  旧前缀 issues/{companyId}/ 下的对象不在视野内(§0.2-d:迁移窗口内不误报
 *  孤儿,也不替用户删旧对象)。 */
async function listObjects(conf: CompanyConf): Promise<Map<string, Date | null>> {
  const objs = new Map<string, Date | null>();
  const stream = minioClient(conf).listObjectsV2(conf.bucket!, `${conf.companyId}/`, true);
  await new Promise<void>((res, rej) => {
    stream.on('data', (o) => o.name && objs.set(o.name, o.lastModified ?? null));
    stream.on('end', res);
    stream.on('error', rej);
  });
  return objs;
}

async function delObject(conf: CompanyConf, key: string): Promise<void> {
  await minioClient(conf).removeObject(conf.bucket!, key);
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@livebook:5433/spms');
  console.log(`mode: ${apply ? 'APPLY (实删)' : 'DRY-RUN (只列出)'};min-age 护栏 ${minAgeDays} 天`);

  // 三 FK 恰一(attachments_one_owner_chk);不 join 任何实体表,按归属分列统计。
  const rows = await sql<AttachmentRow[]>`
    SELECT a.id, a.company_id AS "companyId", a.object_key AS "objectKey",
           a.issue_id AS "issueId", a.test_case_id AS "testCaseId", a.requirement_id AS "requirementId"
    FROM attachments a
  `;
  const confs = await sql<CompanyConf[]>`
    SELECT company_id AS "companyId", backend, endpoint, port, use_ssl AS "useSsl",
           access_key_enc AS "accessKeyEnc", secret_key_enc AS "secretKeyEnc", bucket
    FROM company_storage_configs
  `;
  const confByCompany = new Map(confs.map((c) => [c.companyId, c]));

  let totalOrphans = 0;
  let totalGuarded = 0;
  let totalDeadlinks = 0;
  const deadlinkIds: string[] = [];
  const cutoff = Date.now() - minAgeDays * 86_400_000;

  // 有配置的公司:逐家对账 object_key 行。
  for (const conf of confs) {
    // vercel_blob 后端已移除(TKT-213):历史遗留行无法对账,跳过。
    if (conf.backend !== 'minio') {
      console.log(`公司 ${conf.companyId} 后端 ${conf.backend} 已不支持,跳过`);
      continue;
    }
    const companyRows = rows.filter((r) => r.companyId === conf.companyId && r.objectKey);
    // 按归属实体分列(issue / case / requirement)。
    const byOwner = { issue: 0, case: 0, requirement: 0 };
    for (const r of companyRows) byOwner[r.issueId ? 'issue' : r.testCaseId ? 'case' : 'requirement'] += 1;
    let objs: Map<string, Date | null>;
    try {
      objs = await listObjects(conf);
    } catch (e) {
      console.warn(`公司 ${conf.companyId} 存储不可达,跳过:`, e);
      continue;
    }
    const rowKeys = new Set(companyRows.map((r) => r.objectKey!));
    const orphansAll = [...objs.keys()].filter((k) => !rowKeys.has(k));
    // min-age 护栏:新对象(含未注册粘贴图)跳过不删。
    const guardedSet = new Set(
      orphansAll.filter((k) => {
        const lm = objs.get(k);
        return minAgeDays > 0 && lm && lm.getTime() > cutoff;
      }),
    );
    const orphans = orphansAll.filter((k) => !guardedSet.has(k));
    const guarded = [...guardedSet];
    const deadlinks = companyRows.filter((r) => !objs.has(r.objectKey!));
    totalOrphans += orphans.length;
    totalGuarded += guarded.length;
    totalDeadlinks += deadlinks.length;
    console.log(
      `公司 ${conf.companyId}: DB 行 ${companyRows.length}(issue ${byOwner.issue} / case ${byOwner.case} / requirement ${byOwner.requirement}),对象 ${objs.size};孤儿 ${orphans.length}(护栏跳过 ${guarded.length}),死链 ${deadlinks.length}`,
    );
    for (const k of orphans) console.log(`  orphan   ${k}`);
    for (const k of guarded) console.log(`  guarded  ${k}(创建不足 ${minAgeDays} 天,跳过)`);
    for (const r of deadlinks) console.log(`  deadlink ${ownerOf(r)}  ${r.objectKey}`);
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
  // 存量旧行不再对账(见文件头):@vercel/blob 已移除,列不了远端;VERCEL 死链
  // 只报告不处置。此类行若需清理,由人确认后手动删 DB 行、不触碰远端对象。
  if (legacy.length) console.log(`存量旧行(object_key NULL) ${legacy.length} 条,跳过对账(详见文件头注释)`);

  console.log(`合计: 孤儿 ${totalOrphans}(护栏跳过 ${totalGuarded}),死链行 ${totalDeadlinks}`);
  if (!apply) {
    console.log('dry-run — 加 --apply 执行清理');
  } else if (deadlinkIds.length) {
    const res = await sql`DELETE FROM attachments WHERE id = ANY(${deadlinkIds})`;
    console.log(`done — 删除死链行 ${Number(res.count)}`);
  }
  await sql.end();
}

main();
