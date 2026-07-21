import { ok } from '@/lib/envelope';
import { deleteMcpKey, revokeMcpKey, updateMcpKey } from '@/server/services/platform';
import { jsonBody, requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

/* PATCH /api/v1/platform/mcp-keys/:id { ownerId } — 修改令牌所属人（MCP 调用的
   第一人称身份）。Admins may touch any key; members only their own (service
   enforces). */
export const PATCH = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  const id = (await ctx.params).id;
  return ok(await updateMcpKey(actor, id, await jsonBody<{ ownerId?: string }>(req)));
});

/* DELETE /api/v1/platform/mcp-keys/:id — revoke (revokedAt marks it dead; the
   row stays for audit). With ?permanent=1 the row is hard-deleted instead.
   Admins may touch any key; members only their own (service enforces). */
export const DELETE = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  const id = (await ctx.params).id;
  const permanent = new URL(req.url).searchParams.get('permanent') === '1';
  return ok(permanent ? await deleteMcpKey(actor, id) : await revokeMcpKey(actor, id));
});
