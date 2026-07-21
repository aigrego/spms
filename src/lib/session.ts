import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { env } from './env';
import { ApiException } from './envelope';

/* Cookie session (new in the Next.js rewrite — replaces the portal TDT gate).
   A jose HS256-signed token in an HttpOnly cookie, payload { uid, username,
   role }. Server-side code reads it via getSession()/requireUser(); login
   routes (Phase B2) set it via createSessionCookie(). */

export const SESSION_COOKIE = 'spms_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  uid: string;
  username: string;
  role: string; // 'admin' | 'member' (platform-level)
  cid?: string; // current company id (multi-company sandbox)
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.sessionSecret);
}

/* Sign a session token for the user and return the cookie to set:
   route handlers do `const c = await createSessionCookie(user, companyId);
   (await cookies()).set(c.name, c.value, c.options)` — or
   `response.cookies.set(...)` on a NextResponse. `companyId` becomes the
   session's current company (`cid`); omit it only when the user has no
   resolvable company yet (requireActor will then fall back / 403). */
export async function createSessionCookie(
  user: { id: string; username: string; role: string },
  companyId?: string,
) {
  const value = await new SignJWT({ uid: user.id, username: user.username, role: user.role, cid: companyId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secretKey());
  return {
    name: SESSION_COOKIE,
    value,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: MAX_AGE_SECONDS,
      secure: process.env.NODE_ENV === 'production',
    } as const,
  };
}

/* Verify a raw session token → the payload, or null when invalid/expired. */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const { uid, username, role, cid } = payload;
    if (typeof uid !== 'string' || typeof username !== 'string' || typeof role !== 'string') {
      return null;
    }
    return { uid, username, role, ...(typeof cid === 'string' ? { cid } : {}) };
  } catch {
    return null;
  }
}

/* The current session read from the request cookies (route handlers / server
   components). Null when logged out. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

/* Gate for authenticated routes: returns the session or throws 401. */
export async function requireUser(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new ApiException('UNAUTHORIZED', '未登录', 401);
  return session;
}
