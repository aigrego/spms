import { ok } from '@/lib/envelope';
import { listReports } from '@/server/services/reports';
import { requireActor, route } from '@/server/http';

/* GET /api/v1/pms/reports — 按日期范围/成员/项目过滤的日报列表(含按项目拆分的
   entries)。查询参数:startDate / endDate / memberId / projectId(均可选)。 */
export const GET = route(async (req) => {
  const actor = await requireActor();
  const sp = req.nextUrl.searchParams;
  return ok(
    await listReports(actor, {
      startDate: sp.get('startDate') ?? undefined,
      endDate: sp.get('endDate') ?? undefined,
      memberId: sp.get('memberId') ?? undefined,
      projectId: sp.get('projectId') ?? undefined,
    }),
  );
});
