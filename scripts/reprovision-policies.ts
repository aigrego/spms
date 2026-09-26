/**
 * 重发公司隔离 canned IAM policy（ATTACHMENT-REKEY M1 / TKT-215）：
 * 对象 key 规则从 `issues/{companyId}/*` 改为 `{companyId}/*` 后，已开通
 * （provisioned='auto'）公司的 canned policy 必须重发，否则新 key 写不进。
 *
 * 默认写**双前缀**策略（同时放行 `{companyId}/*` 与 legacy
 * `issues/{companyId}/*`，迁移窗口内旧对象仍可读删）；旧对象由用户手动
 * 删除完毕后，加 --tighten 重跑收紧为仅新前缀。
 *
 * 安全边界：
 *   - 只动 canned policy（create-or-replace 防御：MinIO 对同名策略的 create
 *     为 upsert，个别版本拒绝时回落 remove+create；两种路径都回读
 *     `mc admin policy info` 校验内容一致。已 attach 的策略 MinIO 拒绝
 *     remove——XMinioIAMPolicyInUse——所以绝不能先 remove 再 create）；
 *   - 不触碰 IAM user / secret / 任何 DB 行，不删除任何存储对象；
 *   - 解密后的凭据只进内存，绝不写日志（mc 包装层会对错误消息脱敏）；
 *   - 本脚本不需要用公司受限凭据建 S3 client；若未来加受限凭据探活，必须
 *     pin region: 'us-east-1'（受限凭据无 GetBucketLocation，minio-js 探活
 *     被拒会长重试——见 minio.ts 的 MinioConfig.region 注释）。
 *
 * 用法：
 *   DATABASE_URL=<目标库> CONFIG_CRYPTO_KEY=<hex64> npx tsx scripts/reprovision-policies.ts            # 双前缀重发
 *   DATABASE_URL=<目标库> CONFIG_CRYPTO_KEY=<hex64> npx tsx scripts/reprovision-policies.ts --tighten   # 收紧为仅新前缀
 */
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { decryptSecret } from '../src/server/crypto';
import { withMcAdmin } from '../src/server/storage/mc';

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

const tighten = process.argv.includes('--tighten');

interface PlatformRow {
  backend: string;
  endpoint: string | null;
  port: number | null;
  useSsl: boolean;
  accessKeyEnc: string | null;
  secretKeyEnc: string | null;
  bucket: string | null;
}

/* 键序无关的规范化序列化：mc 回读的策略 JSON 与本端生成文档先统一形态再逐
   字节比对。单元素数组归一为标量、原始值数组排序（AWS policy 语义里
   "x" ≡ ["x"]、Action/Resource 顺序无意义，MinIO 侧可能按任一形态返回）。 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 1) return canonicalJson(value[0]);
    const items = value.map(canonicalJson);
    if (items.every((s) => !s.startsWith('{') && !s.startsWith('['))) items.sort();
    return `[${items.join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/* mc --json admin policy info 输出单行 JSON；策略文档的位置按 mc 版本不同：
   新版在 policyInfo.Policy，旧版 policy 字段可能是对象或字符串——都接住。 */
function extractPolicyDoc(mcOutput: string): unknown {
  for (const line of mcOutput.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const parsed = JSON.parse(t) as Record<string, unknown>;
    const info = parsed.policyInfo as Record<string, unknown> | undefined;
    if (info?.Policy) return info.Policy;
    const doc = parsed.policy;
    if (doc && typeof doc === 'object') return doc;
    if (typeof doc === 'string' && doc.trimStart().startsWith('{')) return JSON.parse(doc);
  }
  throw new Error(`mc admin policy info 输出中未找到 policy 文档: ${mcOutput.slice(0, 200)}`);
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@livebook:5433/spms');
  // provision.ts 经 @/db 读 env，须在 env 加载之后动态引入（同 seed.ts 模式）。
  const { companyPolicyDocument, provisionPolicyName } = await import('../src/server/storage/provision');

  const [platform] = await sql<PlatformRow[]>`
    SELECT backend, endpoint, port, use_ssl AS "useSsl",
           access_key_enc AS "accessKeyEnc", secret_key_enc AS "secretKeyEnc", bucket
    FROM platform_storage_configs WHERE id = 'default'
  `;
  if (!platform || platform.backend !== 'minio' || !platform.endpoint || !platform.accessKeyEnc || !platform.secretKeyEnc || !platform.bucket) {
    throw new Error('平台存储未配置（或非 minio 后端），无可重发的策略');
  }
  const admin = {
    endpoint: platform.endpoint,
    port: platform.port ?? (platform.useSsl ? 443 : 9000),
    useSsl: platform.useSsl,
    accessKey: decryptSecret(platform.accessKeyEnc),
    secretKey: decryptSecret(platform.secretKeyEnc),
  };
  const bucket = platform.bucket;

  const companies = await sql<{ companyId: string }[]>`
    SELECT company_id AS "companyId" FROM company_storage_configs
    WHERE backend = 'minio' AND provisioned = 'auto'
    ORDER BY company_id
  `;
  console.log(`mode: ${tighten ? 'TIGHTEN（仅新前缀 {companyId}/*）' : '双前缀（{companyId}/* + legacy issues/{companyId}/*）'}`);
  console.log(`共 ${companies.length} 家 provisioned='auto' 公司待重发策略`);

  let okCount = 0;
  const failures: { companyId: string; error: string }[] = [];

  for (const c of companies) {
    const policy = provisionPolicyName(c.companyId);
    const expected = companyPolicyDocument(bucket, c.companyId, { includeLegacy: !tighten });
    try {
      await withMcAdmin(admin, async (alias, run, configDir) => {
        const policyFile = join(configDir, 'policy.json');
        await writeFile(policyFile, expected);
        // create-or-replace 防御（不臆断覆盖语义，最终以回读校验为准）：
        // 首选直接 create——MinIO 服务端的 SetPolicy 对同名 canned policy 是
        // upsert，按名 attach 的用户即刻适用新文档（**不能**先 remove 再
        // create：已 attach 的策略会被 MinIO 拒绝删除 XMinioIAMPolicyInUse）。
        // 个别版本若拒绝覆盖（already exists），回落 remove+create（仅对未被
        // attach 的策略可行；已 attach 且拒绝 upsert 的版本无 mc-only 替换路
        // 径，该司计入失败报表）。
        await run(['admin', 'policy', 'create', alias, policy, policyFile]).catch(async () => {
          await run(['admin', 'policy', 'remove', alias, policy]);
          await run(['admin', 'policy', 'create', alias, policy, policyFile]);
        });
        // 回读校验：与生成文档规范化后逐字节一致才算成功。
        const after = await run(['admin', 'policy', 'info', alias, policy]);
        if (canonicalJson(extractPolicyDoc(after)) !== canonicalJson(JSON.parse(expected))) {
          throw new Error('回读策略与生成文档不一致');
        }
      });
      okCount += 1;
      console.log(`ok    ${c.companyId}  policy=${policy} 已重发并回读一致`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push({ companyId: c.companyId, error: msg });
      console.error(`FAIL  ${c.companyId}  ${msg}`);
    }
  }

  console.log(`合计: 成功 ${okCount},失败 ${failures.length}`);
  for (const f of failures) console.log(`  FAILED ${f.companyId}: ${f.error}`);
  await sql.end();
  if (failures.length) process.exit(1);
}

main();
