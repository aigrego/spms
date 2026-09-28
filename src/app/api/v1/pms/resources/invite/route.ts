import { ok } from '@/lib/envelope';
import { invite } from '@/server/services/resources';
import { requireActor, route } from '@/server/http';
import { jsonBodyWith, resourceInviteSchema } from '@/server/validate';

/* POST /api/v1/pms/resources/invite { name?, email?, phone?, userId? } — invite an
   external resource (email/phone/userId at least one; dupes → INVITE_FAILED). */
export const POST = route(async (req) => {
  const actor = await requireActor();
  return ok(await invite(actor, await jsonBodyWith(req, resourceInviteSchema)));
});
