import { ok } from '@/lib/envelope';
import { issueCandidates } from '@/server/services/assignments';
import { requireActor, route } from '@/server/http';
import { requiredParam } from '@/server/params';

/* GET /api/v1/pms/assignments/issue-candidates?issueKey — issue assignee
   candidates (sprint pool → project pool → whole pool; agents always). */
export const GET = route(async (req) => {
  await requireActor();
  const issueKey = requiredParam(req.nextUrl.searchParams.get('issueKey'), 'issueKey');
  return ok(await issueCandidates(issueKey));
});
