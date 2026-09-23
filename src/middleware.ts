import { NextResponse, type NextRequest } from 'next/server';

/* Route guard for the (app) segment: only checks that the spms_session cookie
   EXISTS (verification happens server-side in the API routes). /login with a
   cookie bounces into the app. */
const APP_PREFIXES = [
  '/issues',
  '/my-issues',
  '/products',
  '/requirements',
  '/testcases',
  '/projects',
  '/resources',
  '/roadmap',
  '/summary',
  '/backlog',
  '/sprints',
  '/reports',
  '/integrations',
];

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
  ],
};
