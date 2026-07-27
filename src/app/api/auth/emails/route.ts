import { ok } from '@/lib/envelope';
import { addEmail, emailsOf, removeEmail, setPrimaryEmail } from '@/lib/emails';
import { requireUser } from '@/lib/session';
import { jsonBody, route } from '@/server/http';

/* 当前用户的邮箱管理（user_emails，规则见 src/lib/emails.ts）:
   GET    /api/auth/emails            → 本人的邮箱列表(主邮箱在前)
   POST   /api/auth/emails { email }  → 添加备用邮箱(自填,verified=false)
   PATCH  /api/auth/emails { email }  → 把该邮箱设为主邮箱
   DELETE /api/auth/emails { email }  → 删除备用邮箱(主邮箱不可删) */

const serialize = (rows: Awaited<ReturnType<typeof emailsOf>>) =>
  rows.map((e) => ({ email: e.email, isPrimary: e.isPrimary, verified: e.verified }));

export const GET = route(async () => {
  const session = await requireUser();
  return ok(serialize(await emailsOf(session.uid)));
});

export const POST = route(async (req) => {
  const session = await requireUser();
  const body = await jsonBody<{ email?: string }>(req);
  await addEmail(session.uid, body.email ?? '');
  return ok(serialize(await emailsOf(session.uid)));
});

export const PATCH = route(async (req) => {
  const session = await requireUser();
  const body = await jsonBody<{ email?: string }>(req);
  await setPrimaryEmail(session.uid, body.email ?? '');
  return ok(serialize(await emailsOf(session.uid)));
});

export const DELETE = route(async (req) => {
  const session = await requireUser();
  const body = await jsonBody<{ email?: string }>(req);
  await removeEmail(session.uid, body.email ?? '');
  return ok(serialize(await emailsOf(session.uid)));
});
