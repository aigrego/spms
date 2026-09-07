import { ok } from '@/lib/envelope';
import { createRequirement, listRequirements, type RequirementType } from '@/server/services/requirements';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, requirementCreateSchema } from '@/server/validate';

/* GET  /api/v1/pms/requirements?project&type — list (position asc).
   POST /api/v1/pms/requirements — create (auto FR-N / NFR-N key). */
export const GET = route(async (req) => {
  const actor = await requireActor();
  const sp = req.nextUrl.searchParams;
  return ok(
    await listRequirements(actor, {
      project: sp.get('project') ?? undefined,
      type: (sp.get('type') as RequirementType | null) ?? undefined,
    }),
  );
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  return ok(await createRequirement(actor, await jsonBodyWith(req, requirementCreateSchema)));
});
