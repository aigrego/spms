import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { counters } from '@/db/schema';

// Atomically increment the named counter and return its new value.
// Safe under concurrency: a single INSERT ... ON CONFLICT DO UPDATE takes a
// row lock, so two callers never receive the same number.
export async function nextCounter(name: string): Promise<number> {
  const [row] = await db
    .insert(counters)
    .values({ name, value: 1 })
    .onConflictDoUpdate({
      target: counters.name,
      set: { value: sql`${counters.value} + 1` },
    })
    .returning({ value: counters.value });
  return row.value;
}

// Next business key for a prefix, e.g. nextKey('BUG') → 'BUG-7'.
export async function nextKey(prefix: string): Promise<string> {
  const n = await nextCounter(prefix.toLowerCase());
  return `${prefix}-${n}`;
}
