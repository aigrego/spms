/* Shared bootstrap for scripts/*.ts (run via tsx, not `next` commands):
   loads .env.local / .env into process.env at import time, then fails fast
   on a missing DATABASE_URL (TKT-254) — no hardcoded fallback connection
   string. Import for the side effect alone (seed.ts, which assembles its
   drizzle client via src/db) or use createSql() for the postgres-js client
   the raw-SQL maintenance scripts share. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

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

/* DATABASE_URL 快速失败（TKT-254）：漏配即抛错，不回退到任何写死的连接串。 */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Missing DATABASE_URL — set it in .env.local or .env (see .env.example)');
  }
  return url;
}

/* postgres-js client assembly for the raw-SQL maintenance scripts. */
export function createSql(): postgres.Sql {
  return postgres(databaseUrl());
}
