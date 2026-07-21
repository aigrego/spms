import { ok } from '@/lib/envelope';
import { candidates } from '@/server/services/assignments';
import { requireActor, route } from '@/server/http';
import { asNodeType, requiredParam } from '@/server/params';

/* GET /api/v1/pms/assignments/candidates?nodeType&nodeId — candidate pool
   flagged assignedHere / inParentPool (static segment wins over [id]). */
export const GET = route(async (req) => {
  await requireActor();
  const sp = req.nextUrl.searchParams;
  const nodeType = asNodeType(sp.get('nodeType'));
  const nodeId = requiredParam(sp.get('nodeId'), 'nodeId');
  return ok(await candidates(nodeType, nodeId));
});
