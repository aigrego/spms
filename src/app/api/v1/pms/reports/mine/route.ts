import { ok } from '@/lib/envelope';
import { getMyReport, upsertMyReport, type ReportEntryInput } from '@/server/services/reports';
import { jsonBody, requireActor, route } from '@/server/http';

/* GET /api/v1/pms/reports/mine?date=YYYY-MM-DD — 我某天的日报(无则 null)。
   PUT /api/v1/pms/reports/mine — 覆盖提交我某天的日报(entries 全量替换)。 */
export const GET = route(async (req) => {
  const actor = await requireActor();
  const date = req.nextUrl.searchParams.get('date') ?? '';
  return ok(await getMyReport(actor, date));
});

export const PUT = route(async (req) => {
  const actor = await requireActor();
  return ok(await upsertMyReport(actor, await jsonBody<{ date: string; entries: ReportEntryInput[] }>(req)));
});
