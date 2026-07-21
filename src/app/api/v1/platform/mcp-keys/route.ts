import { ok } from '@/lib/envelope';
import { createMcpKey, listMcpKeys, type CreateMcpKeyInput } from '@/server/services/platform';
import { jsonBody, requireActor, route } from '@/server/http';

/* GET  /api/v1/platform/mcp-keys — keys visible to the actor: admins see all,
   members only their own (keyHash never returned).
   POST /api/v1/platform/mcp-keys { name, companyId? } — mint a key; the
   plaintext is returned ONCE. Admins may mint platform-level (companyId=null)
   keys; members self-service keys scoped to one of their companies (omitted
   companyId → current company). Ownership/scope rules live in the service. */
export const GET = route(async () => {
  const actor = await requireActor();
  return ok(await listMcpKeys(actor));
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  return ok(await createMcpKey(actor, await jsonBody<CreateMcpKeyInput>(req)));
});
