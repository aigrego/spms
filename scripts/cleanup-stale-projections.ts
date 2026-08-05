/**
 * One-off cleanup (2026-07): revoke member projections whose user no longer
 * holds a seat in that company — legacy rows created before ensureCurrentMember
 * required a seat. Mirrors revokeMemberProjection: strip node assignments,
 * mark status='revoked' (the row survives; issues/activities reference it).
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

async function main() {
  const sql = postgres(
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@livebook:5433/spms',
  );

  const stale = await sql<{ id: string; name: string; company_id: string }[]>`
    SELECT m.id, m.name, m.company_id
    FROM members m
    WHERE m.type = 'human' AND m.user_id IS NOT NULL AND m.status <> 'revoked'
      AND NOT EXISTS (
        SELECT 1 FROM company_memberships cm
        WHERE cm.company_id = m.company_id AND cm.user_id = m.user_id
      )
  `;

  if (stale.length === 0) {
    console.log('no stale projections — nothing to do');
  } else {
    console.log(`revoking ${stale.length} stale projection(s):`);
    for (const m of stale) console.log(`  - ${m.name} (${m.id}) company=${m.company_id}`);
    const ids = stale.map((m) => m.id);
    const ra = await sql`DELETE FROM resource_assignments WHERE member_id = ANY(${ids})`;
    await sql`UPDATE members SET status = 'revoked' WHERE id = ANY(${ids})`;
    console.log(`removed ${ra.count} node assignment(s), marked ${ids.length} member(s) revoked`);
  }

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
