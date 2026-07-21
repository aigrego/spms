import { ok } from '@/lib/envelope';
import { impact } from '@/server/services/assignments';
import { requireActor, route } from '@/server/http';
import { asNodeType, requiredParam } from '@/server/params';

/* GET /api/v1/pms/assignments/impact?nodeType&nodeId — cascade impact preview
   (descendants + assignment counts) for the type-to-confirm dialog. */
export const GET = route(async (req) => {
  const actor = await requireActor();
  const sp = req.nextUrl.searchParams;
  const nodeType = asNodeType(sp.get('nodeType'));
  const nodeId = requiredParam(sp.get('nodeId'), 'nodeId');
  return ok(await impact(actor, nodeType, nodeId));
});
