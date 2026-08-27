import { ok } from '@/lib/envelope';
import { createPlan, listPlans } from '@/server/services/plans';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, planCreateSchema } from '@/server/validate';

/* GET  /api/v1/pms/plans?project — list (project takes the project uuid).
   POST /api/v1/pms/plans — create (auto PLAN-N key; author = current member;
   requirementIds are display keys "FR-N"). */
export const GET = route(async (req) => {
  const actor = await requireActor();
  const sp = req.nextUrl.searchParams;
  return ok(await listPlans(actor, { project: sp.get('project') ?? undefined }));
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  return ok(await createPlan(actor, await jsonBodyWith(req, planCreateSchema)));
});
