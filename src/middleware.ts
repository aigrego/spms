import { NextResponse, type NextRequest } from 'next/server';

/* Route guard for the (app) segment: only checks that the spms_session cookie
   EXISTS (verification happens server-side in the API routes). /login with a
   cookie bounces into the app.

   matcher 是受保护路由的唯一清单(单一来源):Next 要求 matcher 为构建期可静态
   分析的字面量(动态值会被忽略,见 node_modules/next/dist/docs proxy 文档),
   所以派生方向只能是 matcher → APP_PREFIXES;新增受保护板块只需在 matcher 里
   加一条 '/xxx/:path*'。 */
export const config = {
  matcher: [
    '/',
    '/login',
    '/issues/:path*',
    '/my-issues/:path*',
    '/products/:path*',
    '/requirements/:path*',
    '/testcases/:path*',
    '/projects/:path*',
    '/resources/:path*',
    '/roadmap/:path*',
    '/summary/:path*',
    '/backlog/:path*',
    '/sprints/:path*',
    '/reports/:path*',
    '/integrations/:path*',
    '/agent-access/:path*',
    '/guide/:path*',
    '/platform/:path*',
    '/profile/:path*',
    '/settings/:path*',
  ],
};

const PATH_SUFFIX = '/:path*';
const APP_PREFIXES = config.matcher
  .filter((m): m is string => typeof m === 'string' && m.endsWith(PATH_SUFFIX))
  .map((m) => m.slice(0, -PATH_SUFFIX.length));

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has('spms_session');
  // Behind a reverse proxy that rewrites the Host header, req.url carries the
  // internal origin; PUBLIC_ORIGIN pins the redirect base when set.
  const base = process.env.PUBLIC_ORIGIN ?? req.url;

  if (pathname === '/login') {
    if (hasSession) return NextResponse.redirect(new URL('/issues', base));
    return NextResponse.next();
  }

  const isAppRoute =
    pathname === '/' || APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isAppRoute && !hasSession) {
    return NextResponse.redirect(new URL('/login', base));
  }
  return NextResponse.next();
}
