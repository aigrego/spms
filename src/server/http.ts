import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { ApiException, fail } from '@/lib/envelope';
import { ensureCurrentMember } from '@/lib/identity';
import { requireUser } from '@/lib/session';
import type { Actor } from './services/types';

/* HTTP plumbing shared by every API route (Phase B2):
   - route()        wraps a handler: ApiException → fail(code,msg,status);
                    unknown errors log + 500 INTERNAL.
   - requireActor() session gate (401) + users row + lazy member projection →
                    the Actor every service expects.
   - jsonBody()     parses the request JSON; malformed → VALIDATION_FAILED.
   - requireAdmin() role gate for admin-only mutations (projects create/delete). */

export function route<Ctx>(
  fn: (req: NextRequest, ctx: Ctx) => Promise<NextResponse>,
): (req: NextRequest, ctx: Ctx) => Promise<NextResponse> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiException) return fail(e.code, e.message, e.status);
      console.error('[api] unexpected error:', e);
      return fail('INTERNAL', '服务内部错误', 500);
    }
  };
}

export async function requireActor(): Promise<Actor> {
  const session = await requireUser(); // throws UNAUTHORIZED 401 when logged out
  const [u] = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.id, session.uid))
    .limit(1);
  if (!u) throw new ApiException('UNAUTHORIZED', '未登录', 401);
  const member = await ensureCurrentMember(u);
  return { userId: u.id, memberId: member.id, name: u.name, role: u.role };
}

export async function jsonBody<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiException('VALIDATION_FAILED', '请求体不是合法 JSON');
  }
}

export function requireAdmin(actor: Actor): void {
  if (actor.role !== 'admin') throw new ApiException('FORBIDDEN', '需要管理员权限', 403);
}
