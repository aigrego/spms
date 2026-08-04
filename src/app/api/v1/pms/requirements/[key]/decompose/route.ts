import { ok } from '@/lib/envelope';
import { decomposeRequirement } from '@/server/services/requirements';
import { requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ key: string }> };

/* POST /api/v1/pms/requirements/:key/decompose — split the acceptance criteria
   (fallback: description lines) into ticket issues linked to the requirement.
   Nothing to split → VALIDATION_FAILED. */
export const POST = route(async (_req, ctx: Ctx) => {
  const actor = await requireActor();
  return ok(await decomposeRequirement(actor, (await ctx.params).key));
});
