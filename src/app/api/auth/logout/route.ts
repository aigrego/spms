import { ok } from '@/lib/envelope';
import { SESSION_COOKIE } from '@/lib/session';
import { route } from '@/server/http';

/* POST /api/auth/logout → clears the session cookie. */
export const POST = route(async () => {
  const res = ok({ loggedOut: true });
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
});
