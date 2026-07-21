import { ok } from '@/lib/envelope';
import { createMcpKey, listMcpKeys, type CreateMcpKeyInput } from '@/server/services/platform';
import { jsonBody, requireActor, requireAdmin, route } from '@/server/http';

/* GET  /api/v1/platform/mcp-keys — all MCP keys (keyHash never returned).
   POST /api/v1/platform/mcp-keys { name, companyId? } — mint a key; the
   plaintext is returned ONCE. Platform admin only. */
export const GET = route(async () => {
  const actor = await requireActor();
  requireAdmin(actor);
  return ok(await listMcpKeys(actor));
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  requireAdmin(actor);
  return ok(await createMcpKey(actor, await jsonBody<CreateMcpKeyInput>(req)));
});
