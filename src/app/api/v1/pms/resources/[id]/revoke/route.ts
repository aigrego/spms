import { ok } from '@/lib/envelope';
import { revoke } from '@/server/services/resources';
import { requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

/* POST /api/v1/pms/resources/:id/revoke — external resources only: unassign
   everywhere + status=revoked. */
export const POST = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await revoke(actor, (await ctx.params).id));
});
