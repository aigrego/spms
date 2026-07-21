import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { ok } from '@/lib/envelope';
import { getSession } from '@/lib/session';
import { route } from '@/server/http';

/* GET /api/auth/session → { user } when logged in, null otherwise.
   (name/role live on the users row, not the JWT, so join it back.) */
export const GET = route(async () => {
  const session = await getSession();
  if (!session) return ok(null);
  const [u] = await db
    .select({ id: users.id, username: users.username, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.id, session.uid))
    .limit(1);
  if (!u) return ok(null);
  return ok({ user: u });
});
