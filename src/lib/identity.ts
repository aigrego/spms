import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { members, labels } from '@/db/schema';

/* Identity mapping (Next.js rewrite). Portal directory sync is gone: a human
   member row projects a local `users` row 1:1 per company
   (members.(companyId, userId) unique). The current user's member is ensured
   lazily on first touch; AI agents and the "AI 生成" label are seeded PER
   COMPANY by scripts/seed.ts and re-ensured here as a fallback.
   Ported from apps/spms-server/src/lib/identity.ts. */

export const AGENT_DEFS = [
  { agentKey: 'atlas', name: 'Atlas', initials: 'A', role: 'plan' },
  { agentKey: 'forge', name: 'Forge', initials: 'F', role: 'code' },
  { agentKey: 'sentry', name: 'Sentry', initials: 'S', role: 'test' },
  { agentKey: 'scribe', name: 'Scribe', initials: 'C', role: 'docs' },
] as const;

// Avatar palette for humans (stable per userId).
const PALETTE = ['#0063D3', '#1F9D55', '#7A5AE0', '#D6293E', '#D89400', '#0EA5A5', '#DB5A00'];
export function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
export function initialsFor(name: string): string {
  const n = name.trim();
  if (!n) return '?';
  // CJK → last character; latin → up to two leading word initials.
  if (/[㐀-鿿]/.test(n)) return n.slice(-1);
  const parts = n.split(/\s+/).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : n.slice(0, 2)).toUpperCase();
}

export type MemberRow = typeof members.$inferSelect;

// Ensure the four AI agents exist in the given company (idempotent; seed
// already inserts them — this is the fallback for empty databases).
export async function ensureAgents(companyId: string): Promise<void> {
  const existing = await db
    .select({ agentKey: members.agentKey })
    .from(members)
    .where(and(eq(members.companyId, companyId), eq(members.type, 'agent')));
  const have = new Set(existing.map((r) => r.agentKey));
  const missing = AGENT_DEFS.filter((a) => !have.has(a.agentKey));
  if (missing.length) {
    await db
      .insert(members)
      .values(
        missing.map((a) => ({
          id: crypto.randomUUID(),
          companyId,
          type: 'agent' as const,
          name: a.name,
          initials: a.initials,
          color: null,
          role: a.role,
          userId: null,
          agentKey: a.agentKey,
        })),
      )
      .onConflictDoNothing();
  }
}

// Ensure the well-known "AI 生成" label exists in the given company; returns
// its id.
export async function ensureAiLabel(companyId: string): Promise<string> {
  const [row] = await db
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.companyId, companyId), eq(labels.key, 'ai')))
    .limit(1);
  if (row) return row.id;
  const id = crypto.randomUUID();
  await db
    .insert(labels)
    .values({ id, companyId, key: 'ai', name: 'AI 生成', color: '#FF6B02' })
    .onConflictDoNothing();
  const [after] = await db
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.companyId, companyId), eq(labels.key, 'ai')))
    .limit(1);
  return after?.id ?? id;
}

// Ensure a member row exists for the given local user in the given company;
// create it (human, origin=internal, status=active) when missing. On first
// creation also ensure the agents + AI label exist (lazy bootstrap fallback).
// Returns the member row.
export async function ensureCurrentMember(user: { id: string; name: string }, companyId: string): Promise<MemberRow> {
  const [existing] = await db
    .select()
    .from(members)
    .where(and(eq(members.companyId, companyId), eq(members.userId, user.id)))
    .limit(1);
  if (existing) return existing;

  await ensureAgents(companyId);
  await ensureAiLabel(companyId);
  const id = crypto.randomUUID();
  await db
    .insert(members)
    .values({
      id,
      companyId,
      type: 'human',
      name: user.name,
      initials: initialsFor(user.name),
      color: colorFor(user.id),
      role: null,
      userId: user.id,
      agentKey: null,
    })
    .onConflictDoNothing();
  const [after] = await db
    .select()
    .from(members)
    .where(and(eq(members.companyId, companyId), eq(members.userId, user.id)))
    .limit(1);
  if (after) return after;
  // Extremely unlikely: a conflicting insert raced us with a different userId
  // mapping. Fall back to the row we just tried to insert's id.
  const [byId] = await db.select().from(members).where(eq(members.id, id)).limit(1);
  return byId;
}
