import { ok } from '@/lib/envelope';
import { reportStats } from '@/server/services/reports';
import { requireActor, route } from '@/server/http';

/* GET /api/v1/pms/reports/stats?today=YYYY-MM-DD — 提交情况统计(今日已交/未交
   名单、7 日趋势、累计)。today 由客户端按本地时区给出;缺省回退服务器 UTC 日。 */
export const GET = route(async (req) => {
  const actor = await requireActor();
  const today = req.nextUrl.searchParams.get('today') ?? new Date().toISOString().slice(0, 10);
  return ok(await reportStats(actor, today));
});
