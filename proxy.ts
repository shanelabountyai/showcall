import { NextResponse, type NextRequest } from 'next/server';
import { gate } from './src/demo-gate';

/** Every route sits behind the demo password (D-032), except the cron, which carries its own CRON_SECRET. */
export function proxy(req: NextRequest) {
  switch (gate(req.headers.get('authorization'), process.env)) {
    case 'open':
    case 'allowed':
      return NextResponse.next();
    case 'misconfigured':
      return new NextResponse('Demo password not configured', { status: 503 });
    case 'challenge':
      return new NextResponse('Password required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Demo", charset="UTF-8"' } });
  }
}

export const config = {
  matcher: '/((?!api/cron/|_next/static|_next/image|favicon.ico).*)',
};
