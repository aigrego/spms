import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { members, users } from '@/db/schema';
import { ApiException } from '@/lib/envelope';
import { initialsFor, colorFor } from '@/lib/identity';
import { unassignMemberEverywhere } from '@/lib/assignments';

/* PMS-2 §5.1 — 研发资源池 (resource pool) business service. Ported from
   apps/spms-server/src/routes/resources.ts. The pool = every `members` row:
   internal humans (local users), invited external resources, and AI agents.
   External resources are nameable/assignable/displayable now; their real login
   is deferred. The portal sync-directory endpoint has no rewrite equivalent
   (no portal directory). */

type MemberRow = typeof members.$inferSelect;

export function serializeMember(m: MemberRow) {
  return {
    id: m.id,
    type: m.type,
    name: m.name,
    initials: m.initials,
    color: m.color,
    role: m.role,
    userId: m.userId,
    agentKey: m.agentKey,
    origin: m.origin,
    email: m.email,
    status: m.status,
  };
}

/* ---- list the resource pool (internal / external / agent, with status) ---- */
export async function listMembers() {
  const rows = await db.select().from(members).orderBy(asc(members.type), asc(members.name));
  return rows.map(serializeMember);
}

export interface InviteInput {
  name?: string;
  email?: string;
  userId?: string; // a local users.id not yet projected into the pool
}

/* ---- invite an external resource (email, or a local user from outside the pool) ----
   At least one of email / userId is required; the pool is de-duped on both. */
export async function invite(input: InviteInput) {
  const email = input.email?.trim() || null;
  const userId = input.userId?.trim() || null;
  if (!email && !userId) throw new ApiException('VALIDATION_FAILED', '请提供邮箱或用户 ID');

  // De-dup against the existing pool (PMS-2 §2.1 — unique(email) / unique(userId)).
  if (email) {
    const [dupe] = await db.select({ id: members.id }).from(members).where(eq(members.email, email)).limit(1);
    if (dupe) throw new ApiException('INVITE_FAILED', '该邮箱已在资源池中');
  }
  let invitedUserName: string | null = null;
  if (userId) {
    const [dupe] = await db.select({ id: members.id }).from(members).where(eq(members.userId, userId)).limit(1);
    if (dupe) throw new ApiException('INVITE_FAILED', '该用户已在资源池中');
    // Default the display name from the local users row when one exists.
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    invitedUserName = u?.name ?? null;
  }

  const name = (input.name?.trim() || invitedUserName || email?.split('@')[0] || userId || '外部资源').trim();
  const id = crypto.randomUUID();
  await db.insert(members).values({
    id,
    type: 'human',
    name,
    initials: initialsFor(name),
    color: colorFor(email ?? userId ?? name),
    role: null,
    userId,
    agentKey: null,
    origin: 'external',
    email,
    status: 'invited',
  });

  const [row] = await db.select().from(members).where(eq(members.id, id)).limit(1);
  return serializeMember(row!);
}

/* ---- revoke an external resource: status=revoked + unassign from all nodes ---- */
export async function revoke(id: string) {
  const [m] = await db.select().from(members).where(eq(members.id, id)).limit(1);
  if (!m) throw new ApiException('RESOURCE_NOT_FOUND');
  if (m.origin !== 'external') throw new ApiException('VALIDATION_FAILED', '只能撤销外部资源');
  await unassignMemberEverywhere(m.id);
  await db.update(members).set({ status: 'revoked' }).where(eq(members.id, m.id));
  return { id: m.id, status: 'revoked' as const };
}
