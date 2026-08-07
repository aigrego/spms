import { ok } from '@/lib/envelope';
import { addComment } from '@/server/services/issues';
import { requireActor, route } from '@/server/http';
import { commentCreateSchema, jsonBodyWith } from '@/server/validate';

type Ctx = { params: Promise<{ key: string }> };

/* POST /api/v1/pms/issues/:key/comments { body } — adds an activity + bumps
   commentsCount. */
export const POST = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  const { body } = await jsonBodyWith(req, commentCreateSchema);
  return ok(await addComment(actor, (await ctx.params).key, body));
});
