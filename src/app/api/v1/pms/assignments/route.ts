import { ok } from '@/lib/envelope';
import { assign, listByNode, remove, type AssignInput } from '@/server/services/assignments';
import { jsonBody, requireActor, route } from '@/server/http';
import { asNodeType, asRole, requiredParam } from '@/server/params';

/* GET    /api/v1/pms/assignments?nodeType&nodeId — a node's virtual team.
   POST   /api/v1/pms/assignments { nodeType, nodeId, memberId, role? } — assign
          (propagates up the ancestor chain; revoked → RESOURCE_REVOKED).
   DELETE /api/v1/pms/assignments?nodeType&nodeId&memberId — unassign (cascade
          down + GC; propagated rows rejected). */
export const GET = route(async (req) => {
  await requireActor();
  const sp = req.nextUrl.searchParams;
  const nodeType = asNodeType(sp.get('nodeType'));
  const nodeId = requiredParam(sp.get('nodeId'), 'nodeId');
  return ok(await listByNode(nodeType, nodeId));
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  const body = await jsonBody<Partial<AssignInput>>(req);
  const input: AssignInput = {
    nodeType: asNodeType(body.nodeType),
    nodeId: requiredParam(body.nodeId, 'nodeId'),
    memberId: requiredParam(body.memberId, 'memberId'),
    role: body.role === undefined ? undefined : asRole(body.role),
  };
  return ok(await assign(actor, input));
});

export const DELETE = route(async (req) => {
  await requireActor();
  const sp = req.nextUrl.searchParams;
  const nodeType = asNodeType(sp.get('nodeType'));
  const nodeId = requiredParam(sp.get('nodeId'), 'nodeId');
  const memberId = requiredParam(sp.get('memberId'), 'memberId');
  return ok(await remove(nodeType, nodeId, memberId));
});
