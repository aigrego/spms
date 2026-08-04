import { ok } from '@/lib/envelope';
import { listReports } from '@/server/services/reports';
import { requireActor, route } from '@/server/http';

/* GET /api/v1/pms/reports — 按日期范围/成员/产品过滤的日报列表(含按产品拆分的
   entries)。查询参数:startDate / endDate / memberId / productId(均可选)。 */
export const GET = route(async (req) => {
  const actor = await requireActor();
  const sp = req.nextUrl.searchParams;
  return ok(
    await listReports(actor, {
      startDate: sp.get('startDate') ?? undefined,
      endDate: sp.get('endDate') ?? undefined,
      memberId: sp.get('memberId') ?? undefined,
      productId: sp.get('productId') ?? undefined,
    }),
  );
});
