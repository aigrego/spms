import { ok } from '@/lib/envelope';
import { invite, type InviteInput } from '@/server/services/resources';
import { jsonBody, requireActor, route } from '@/server/http';

/* POST /api/v1/pms/resources/invite { name?, email?, userId? } — invite an
   external resource (email/userId at least one; dupes → INVITE_FAILED). */
export const POST = route(async (req) => {
  const actor = await requireActor();
  return ok(await invite(actor, await jsonBody<InviteInput>(req)));
});
