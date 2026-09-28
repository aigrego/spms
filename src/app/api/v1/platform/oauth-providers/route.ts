import { ok } from '@/lib/envelope';
import { publicOrigin, requireActor, route } from '@/server/http';
import { deleteOAuthProvider, listOAuthProviders, saveOAuthProvider } from '@/server/services/oauth';
import { jsonBodyWith, oauthProviderSaveSchema } from '@/server/validate';

/* GET/PUT/DELETE /api/v1/platform/oauth-providers — 平台管理员在 设置→三方登录
   管理飞书/Lark/GitHub 的登录凭据。薄路由：DB/env 来源取舍、secret 加密落库
   （永不回显，GET 只回 hasSecret）等业务逻辑见 @/server/services/oauth。 */

export const GET = route(async (req) => ok(await listOAuthProviders(await requireActor(), publicOrigin(req))));

export const PUT = route(async (req) =>
  ok(await saveOAuthProvider(await requireActor(), await jsonBodyWith(req, oauthProviderSaveSchema))),
);

export const DELETE = route(async (req) =>
  ok(await deleteOAuthProvider(await requireActor(), req.nextUrl.searchParams.get('provider') ?? '')),
);
