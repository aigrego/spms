import { ok, ApiException } from '@/lib/envelope';
import { addComment } from '@/server/services/issues';
import { jsonBody, requireActor, route } from '@/server/http';

type Ctx = { params: Promise<{ key: string }> };

/* POST /api/v1/pms/issues/:key/comments { body } — adds an activity + bumps
   commentsCount. */
export const POST = route(async (req, ctx: Ctx) => {
  const actor = await requireActor();
  const body = await jsonBody<{ body?: string }>(req);
  if (typeof body.body !== 'string' || !body.body.trim()) {
    throw new ApiException('VALIDATION_FAILED', '评论内容不能为空');
  }
  return ok(await addComment(actor, (await ctx.params).key, body.body));
});
