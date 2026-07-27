import { ok } from '@/lib/envelope';
import { deleteUser } from '@/server/services/platform';
import { requireActor, requireAdmin, route } from '@/server/http';

type Ctx = { params: Promise<{ userId: string }> };

/* DELETE /api/v1/platform/users/:userId — 删除系统账号:先 revoke 其在各家
   公司的 member 投影(移出指派、置 revoked,行保留),再删 users 行(FK
   兜底 members.userId set null)。不能删除当前登录账号。Platform admin only. */
export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  requireAdmin(actor);
  return ok(await deleteUser(actor, (await ctx.params).userId));
});
