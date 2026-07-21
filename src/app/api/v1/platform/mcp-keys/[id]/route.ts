import { ok } from '@/lib/envelope';
import { deleteMcpKey, revokeMcpKey } from '@/server/services/platform';
import { requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

/* DELETE /api/v1/platform/mcp-keys/:id — revoke (revokedAt marks it dead; the
   row stays for audit). With ?permanent=1 the row is hard-deleted instead.
   Admins may touch any key; members only their own (service enforces). */
export const DELETE = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  const id = (await ctx.params).id;
  const permanent = new URL(req.url).searchParams.get('permanent') === '1';
  return ok(permanent ? await deleteMcpKey(actor, id) : await revokeMcpKey(actor, id));
});
