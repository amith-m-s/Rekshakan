import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

// Optional shared password for the dashboard. When DASHBOARD_PASSWORD is set, every page and API
// route asks for HTTP Basic auth (any username), except the read and report endpoints the mobile
// app uses. The browser remembers the credentials and sends them with the dashboard's own API calls.

function isPublic(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/api/reports') return req.method === 'GET' || req.method === 'POST';
  if (pathname === '/api/zones' || pathname === '/api/fires' || pathname === '/api/alert') return req.method === 'GET';
  return false;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

function passwordMatches(header: string | null, password: string) {
  const [scheme, encoded] = header?.split(' ') ?? [];
  if (scheme !== 'Basic' || !encoded) return false;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const supplied = decoded.slice(decoded.indexOf(':') + 1);
  return timingSafeEqual(digest(supplied), digest(password));
}

export function proxy(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password || isPublic(req) || passwordMatches(req.headers.get('authorization'), password)) {
    return NextResponse.next();
  }
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="RescuerMap", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
