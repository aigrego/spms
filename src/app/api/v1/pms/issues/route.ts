import { ok } from '@/lib/envelope';
import { createIssue, listIssues } from '@/server/services/issues';
import { requireActor, route } from '@/server/http';
import { issueCreateSchema, jsonBodyWith } from '@/server/validate';

/* GET  /api/v1/pms/issues?team&assignee&project&includeArchived&recentDone — list (展示 ID 尾号数字倒序)。
       默认排除已归档 issue 及已归档项目的 issue;includeArchived=1 放行。
       recentDone=1 时已完成(done)只显示最近一周完成的记录(按 completedAt,
       全部/我的 Issues 视图 opt-in,其余消费方默认拿全量)。
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
      recentDoneOnly: sp.get('recentDone') === '1',
    }),
  );
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  return ok(await createIssue(actor, await jsonBodyWith(req, issueCreateSchema)));
});
