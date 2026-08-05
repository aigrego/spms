import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@livebook:5433/spms';

// postgres-js client. Next.js dev mode hot-reloads modules, so cache the client
// on globalThis to avoid exhausting PG connections across reloads.
const globalForDb = globalThis as unknown as { __spmsSql?: postgres.Sql };
const sql = globalForDb.__spmsSql ?? postgres(connectionString);
if (process.env.NODE_ENV !== 'production') globalForDb.__spmsSql = sql;

export const db = drizzle(sql, { schema });
export { schema };
