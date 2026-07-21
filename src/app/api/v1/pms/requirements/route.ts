import { ok } from '@/lib/envelope';
import {
  createRequirement,
  listRequirements,
  type CreateRequirementInput,
  type RequirementType,
} from '@/server/services/requirements';
import { jsonBody, requireActor, route } from '@/server/http';

/* GET  /api/v1/pms/requirements?project&type — list (position asc).
   POST /api/v1/pms/requirements — create (auto FR-N / NFR-N key). */
export const GET = route(async (req) => {
  await requireActor();
  const sp = req.nextUrl.searchParams;
  return ok(
    await listRequirements({
      project: sp.get('project') ?? undefined,
      type: (sp.get('type') as RequirementType | null) ?? undefined,
    }),
  );
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  return ok(await createRequirement(actor, await jsonBody<CreateRequirementInput>(req)));
});
