import { ok } from '@/lib/envelope';
import { teamSummary } from '@/server/services/summary';
import { requireActor, route } from '@/server/http';

/* GET /api/v1/pms/summary — 团队总结统计。查询参数:period=daily|weekly、
   date=YYYY-MM-DD(客户端本地日历日;weekly 时为周内任意日)、tzMin(本地 =
   UTC + tzMin 分钟)、memberId / projectId(均可选)。模块门:reports。 */
export const GET = route(async (req) => {
  const actor = await requireActor();
  const sp = req.nextUrl.searchParams;
  const period = sp.get('period') === 'weekly' ? ('weekly' as const) : ('daily' as const);
  const tzMin = sp.get('tzMin');
  return ok(
    await teamSummary(actor, {
      period,
      date: sp.get('date') ?? '',
      tzMin: tzMin == null ? undefined : Number(tzMin),
      memberId: sp.get('memberId') ?? undefined,
      projectId: sp.get('projectId') ?? undefined,
    }),
  );
});
