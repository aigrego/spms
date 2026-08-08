import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { members, labels, companyMemberships } from '@/db/schema';
import { unassignMemberEverywhere } from '@/lib/assignments';

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

// Claim pending external invites (研发资源页「邀请外部资源」写入的 members 行:
// origin='external', status='invited', userId=null) whose email OR phone
// matches the OAuth-verified identity. For every claimed row: backfill userId,
// flip to internal/active, and grant a company seat (company_memberships, 默认
// 'viewer' — 与平台管理员手动分配席位的默认角色一致). One identity may be
// invited by several companies — every inviting company gets a seat.
// Returns the number of claimed invites.

/* 手机号归一化为纯数字（飞书 user_info 返回带国家码如 +86138…；邀请人可能填
   不带国家码的本地号）。 */
export function normalizePhone(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

/* 手机号匹配：全等，或短串（≥7 位防误配）作为长串后缀——兼容「有无国家码」
   两种写法（8613800138000 vs 13800138000）。 */
export function phoneMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 7 && longer.endsWith(shorter);
}

export async function claimExternalInvites(
  user: { id: string; avatarUrl?: string | null },
  ids: { emails?: string[]; mobile?: string },
): Promise<number> {
  const normalizedEmails = [
    ...new Set((ids.emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean)),
  ];
  const mobileDigits = normalizePhone(ids.mobile);
  if (!normalizedEmails.length && !mobileDigits) return 0;
  // 先按邮箱精确命中 + 有手机号的待认领行取回，手机号后缀匹配在 JS 侧做
  // （SQL 表达后缀匹配反而更绕；待认领行量级极小）。
  const candidates = await db
    .select({ id: members.id, companyId: members.companyId, email: members.email, phone: members.phone })
    .from(members)
    .where(
      and(
        eq(members.origin, 'external'),
        eq(members.status, 'invited'),
        isNull(members.userId),
        or(
          normalizedEmails.length
            ? inArray(sql`lower(${members.email})`, normalizedEmails)
            : undefined,
          mobileDigits ? isNotNull(members.phone) : undefined,
        ),
      ),
    );
  const invites = candidates.filter(
    (c) =>
      (c.email && normalizedEmails.includes(c.email.trim().toLowerCase())) ||
      (mobileDigits && c.phone && phoneMatches(normalizePhone(c.phone), mobileDigits)),
  );
  let claimed = 0;
  for (const inv of invites) {
    // Skip companies where the user already projects a member row — the
    // (companyId, userId) unique index forbids backfilling this invite; the
    // seat/member already exists so there is nothing to claim.
    const [existing] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.companyId, inv.companyId), eq(members.userId, user.id)))
      .limit(1);
    if (existing) continue;
    // 认领 = members 行回填(internal/active)+ viewer 席位授予,同生同灭 →
    // 一个事务;失败则该邀请整体跳过,不留"已认领但无席位"的半截状态。
    await db.transaction(async (tx) => {
      await tx
        .update(members)
        .set({ userId: user.id, origin: 'internal', status: 'active', avatarUrl: user.avatarUrl ?? null })
        .where(eq(members.id, inv.id));
      await tx
        .insert(companyMemberships)
        .values({ id: crypto.randomUUID(), userId: user.id, companyId: inv.companyId, role: 'viewer' })
        .onConflictDoNothing();
    });
    claimed += 1;
  }
  return claimed;
}

// Sync the user's display profile (name/initials/avatar) onto every member
// row projecting them — called after OAuth login refreshes the profile and
// after the profile-page rename, so all companies see the same identity.
export async function syncMemberProjection(user: {
  id: string;
  name: string;
  avatarUrl?: string | null;
}): Promise<void> {
  await db
    .update(members)
    .set({ name: user.name, initials: initialsFor(user.name), avatarUrl: user.avatarUrl ?? null })
    .where(eq(members.userId, user.id));
}

// Ensure a member row exists for the given local user in the given company;
// create it (human, origin=internal, status=active) when missing. Only users
// holding a seat (company_memberships) are projected — a seat-less platform
// admin gets null, so merely entering a company sandbox no longer pollutes
// its resource pool. A previously revoked projection is reactivated when the
// user holds a seat again. On first creation also ensure the agents + AI
// label exist (lazy bootstrap fallback). Returns the member row, or null.
export async function ensureCurrentMember(
  user: { id: string; name: string; avatarUrl?: string | null },
  companyId: string,
): Promise<MemberRow | null> {
  const [seat] = await db
    .select({ id: companyMemberships.id })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.userId, user.id), eq(companyMemberships.companyId, companyId)))
    .limit(1);

  const [existing] = await db
    .select()
    .from(members)
    .where(and(eq(members.companyId, companyId), eq(members.userId, user.id)))
    .limit(1);
  if (existing) {
    if (existing.status === 'revoked' && seat) {
      await db.update(members).set({ status: 'active' }).where(eq(members.id, existing.id));
      existing.status = 'active';
    }
    return existing;
  }
  if (!seat) return null;

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
      avatarUrl: user.avatarUrl ?? null,
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
  return byId ?? null;
}

/* Revoke a user's member projection in a company (seat removed): strip every
   node assignment and mark the row revoked so it leaves assignee candidate
   lists. The row itself survives — issues/activities/etc. reference it without
   cascade. Re-granting a seat reactivates it via ensureCurrentMember. */
export async function revokeMemberProjection(companyId: string, userId: string): Promise<void> {
  const [m] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.companyId, companyId), eq(members.userId, userId)))
    .limit(1);
  if (!m) return;
  await unassignMemberEverywhere(companyId, m.id);
  await db.update(members).set({ status: 'revoked' }).where(eq(members.id, m.id));
}
