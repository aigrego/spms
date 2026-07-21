import { fail } from '@/lib/envelope';
import { requireUser } from '@/lib/session';
import { enterCompanyResponse, jsonBody, route } from '@/server/http';

/* POST /api/auth/switch-company { companyId } → re-signed session cookie whose
   `cid` points at the new company. Requires membership in the target company,
   or platform admin (target company must exist). Everything else in the
   session payload (uid/username/role) is preserved. */
export const POST = route(async (req) => {
  const session = await requireUser();
  const body = await jsonBody<{ companyId?: string }>(req);
  const companyId = body.companyId?.trim();
  if (!companyId) return fail('VALIDATION_FAILED', 'companyId 必填');
  return enterCompanyResponse(session.uid, companyId);
});
