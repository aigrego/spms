import { ok } from '@/lib/envelope';
import { revokeMcpKey } from '@/server/services/platform';
import { requireActor, requireAdmin, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

/* DELETE /api/v1/platform/mcp-keys/:id — revoke (revokedAt marks it dead; the
   row stays for audit). Platform admin only. */
export const DELETE = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  requireAdmin(actor);
  return ok(await revokeMcpKey(actor, (await ctx.params).id));
});
