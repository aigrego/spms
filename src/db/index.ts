import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@/lib/env';
import * as schema from './schema';

// DATABASE_URL 的默认值统一收敛在 @/lib/env（env.databaseUrl），此处不再自带 fallback。
const connectionString = env.databaseUrl;

// postgres-js client. Next.js dev mode hot-reloads modules, so cache the client
// on globalThis to avoid exhausting PG connections across reloads.
const globalForDb = globalThis as unknown as { __spmsSql?: postgres.Sql };
const sql = globalForDb.__spmsSql ?? postgres(connectionString);
if (process.env.NODE_ENV !== 'production') globalForDb.__spmsSql = sql;

export const db = drizzle(sql, { schema });
export { schema };
