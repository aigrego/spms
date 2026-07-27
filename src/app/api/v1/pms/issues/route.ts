import { ok } from '@/lib/envelope';
import { createIssue, listIssues, type CreateIssueInput } from '@/server/services/issues';
import { jsonBody, requireActor, route } from '@/server/http';

/* GET  /api/v1/pms/issues?team&assignee&project&includeArchived — list (updatedAt desc).
       默认排除已归档 issue 及已归档项目的 issue;includeArchived=1 放行。
   POST /api/v1/pms/issues — create (title required; key BUG-/TKT-/BLG- per type, or caller-supplied `key`). */
export const GET = route(async (req) => {
  const actor = await requireActor();
  const sp = req.nextUrl.searchParams;
  return ok(
    await listIssues(actor, {
      team: sp.get('team') ?? undefined,
      assignee: sp.get('assignee') ?? undefined,
      project: sp.get('project') ?? undefined,
      includeArchived: sp.get('includeArchived') === '1',
    }),
  );
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  return ok(await createIssue(actor, await jsonBody<CreateIssueInput>(req)));
});
