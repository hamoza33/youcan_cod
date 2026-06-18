import { NextRequest, NextResponse } from 'next/server';
import { isValidSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth/session';

const protectedPrefixes = ['/dashboard', '/api/jobs', '/api/youcan', '/api/health'];
const apiPrefixes = ['/api/jobs', '/api/youcan', '/api/health'];

export async function middleware(request: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (!protectedPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (await isValidSessionToken(token, adminPassword)) {
    return NextResponse.next();
  }

  if (apiPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/jobs/:path*', '/api/youcan/:path*', '/api/health', '/api/health/:path*'],
};
