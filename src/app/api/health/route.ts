import { ok } from '@/lib/envelope';

/* GET /api/health — 部署健康检查（无需登录，middleware 不拦截 /api）。 */
export function GET() {
  return ok({ status: 'ok' });
}
