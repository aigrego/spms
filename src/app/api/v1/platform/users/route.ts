import { ok } from '@/lib/envelope';
import { createUser, listAllUsers } from '@/server/services/platform';
import { requireActor, requireAdmin, route } from '@/server/http';
import { jsonBodyWith, userCreateSchema } from '@/server/validate';

/* GET  /api/v1/platform/users — 平台成员目录:全部系统用户 + 公司席位。
   POST /api/v1/platform/users — 新建系统账号(不含席位,席位在公司卡片分配)。
   Platform admin only. */
export const GET = route(async () => {
  const actor = await requireActor();
  requireAdmin(actor);
  return ok(await listAllUsers(actor));
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  requireAdmin(actor);
  return ok(await createUser(actor, await jsonBodyWith(req, userCreateSchema)));
});
