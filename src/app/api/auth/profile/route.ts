import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { members, users } from '@/db/schema';
import { ok, fail } from '@/lib/envelope';
import { initialsFor } from '@/lib/identity';
import { requireUser } from '@/lib/session';
import { jsonBody, route } from '@/server/http';

/* PATCH /api/auth/profile { name } → update the signed-in user's display
   name. The 1:1 human member rows (one per company) mirror the name so
   avatars/assignees stay in sync. */
export const PATCH = route(async (req) => {
  const session = await requireUser();
  const body = await jsonBody<{ name?: string }>(req);
  const name = body.name?.trim();
  if (!name) return fail('VALIDATION_FAILED', '姓名不能为空');
  if (name.length > 50) return fail('VALIDATION_FAILED', '姓名过长');

  await db.update(users).set({ name }).where(eq(users.id, session.uid));
  await db
    .update(members)
    .set({ name, initials: initialsFor(name) })
    .where(eq(members.userId, session.uid));

  const [u] = await db
    .select({ id: users.id, username: users.username, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.id, session.uid))
    .limit(1);
  return ok({ user: u });
});
