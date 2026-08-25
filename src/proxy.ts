import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ─── Security: Public routes that do NOT require authentication ───────
const PUBLIC_PREFIXES = [
  '/api/auth/', // login, logout, me
  '/api/guest/', // guest portal (token-based)
  '/api/public/', // public capture, availability
  '/api/ical-export/', // iCal feed (token-based URL)
  '/api/ical-sync/', // iCal cron sync (own ?secret= auth)
  '/api/booking/', // guest self-registration, payments
  '/api/cron/', // cron jobs (own secret-header auth)
  '/api/widget', // widget-* endpoints (public embed)
  // '/api/file-upload' is deliberately absent. It was public for the retired
  // /book wizard; every caller is now a dashboard screen, and an open upload
  // endpoint is an invitation. Do not add it back.
  '/api/platform/login', // the supplier's own entrance (own cookie, own tables)
  '/app/platform/login', // its login page
  '/app/login', // login page — the only public path under /app
  '/login', // legacy /login, redirects to /app/login
  '/guest/', // guest portal page
  '/report/', // published partner report — the 64-hex token in the URL is the credential
  '/privacy', // the privacy policy — a legal page guests must reach without a login
  '/w/', // booking widget
  '/modules/', // marketing site: one page per product module
  '/blog/', // marketing site: journal posts
];

// ─── Public marketing site — src/app/(marketing) ──────────────────────
// Every page of the landing site is public by definition. '/' is the site,
// not a redirect; the operator app lives under /app and starts at
// /app/login.
const MARKETING_PAGES = [
  '/',
  '/product',
  '/agents',
  '/solutions',
  '/integrations',
  '/cases',
  '/blog',
  '/about',
  '/demo',
];

const PUBLIC_EXACT = [
  ...MARKETING_PAGES,
  '/app/login',
  '/login',
  // '/book' removed with the single-property wizard; the public widget is
  // '/w/<slug>', already covered by the prefix list above.
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/admin/export-may',
];

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_EXACT.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// ─── Legacy operator routes ───────────────────────────────────────────
// The app used to sit at the top level, so every bookmark and e-mail link
// an operator saved points at the old path. Redirect rather than 404 — one
// rule here beats a stub page per section.
const MOVED_TO_APP = [
  'dashboard',
  'bookings',
  'calendar',
  'finance',
  'tasks',
  'settings',
  'sites',
  'reports',
  'guests',
  'pricing',
  'imports',
  'documents',
  'audit',
  'guest-registry',
];

function legacyAppPath(pathname: string): string | null {
  const segment = pathname.split('/')[1] ?? '';
  return MOVED_TO_APP.includes(segment) ? `/app${pathname}` : null;
}

// ─── Device detection ─────────────────────────────────────────────────
const MOBILE_UA = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ─── Legacy operator routes ─────────────────────────────────────────
  // Before the auth gate, so an old link lands on the right page rather than
  // on the dashboard by way of the login screen.
  if (!pathname.startsWith('/api/')) {
    const moved = legacyAppPath(pathname);
    if (moved) {
      const target = request.nextUrl.clone();
      target.pathname = moved;
      return NextResponse.redirect(target, 308);
    }
  }

  // ─── Auth gate ──────────────────────────────────────────────────────
  if (!isPublicRoute(pathname)) {
    const sessionId = request.cookies.get('session_id')?.value;

    // The supplier's session is a different cookie. The gate only asks whether
    // SOME session is present — which of the two it is, and whether it may
    // touch this organization, is decided by currentActor() further in. Without
    // this the platform operator would be refused at the door by a check that
    // only knows one kind of key.
    const platformSessionId = request.cookies.get('platform_session_id')?.value;
    const anySession = sessionId || platformSessionId;

    if (pathname.startsWith('/api/')) {
      // API routes: return 401 JSON when no session is present
      if (!anySession) {
        return NextResponse.json({ error: 'Unauthorized — session required' }, { status: 401 });
      }
    } else {
      // Dashboard pages: redirect to login. A platform operator inside a
      // hotel sees the ordinary screens, so their cookie counts here too.
      if (!anySession) {
        const loginUrl = request.nextUrl.clone();
        loginUrl.pathname = '/app/login';
        return NextResponse.redirect(loginUrl);
      }
    }
  }

  // ─── Device detection (existing logic) ──────────────────────────────
  const response = NextResponse.next();

  // Allow force override via cookie (for testing)
  const forceDevice = request.cookies.get('force-device')?.value;
  if (forceDevice) {
    response.headers.set('x-device-type', forceDevice);
    return response;
  }

  const ua = request.headers.get('user-agent') || '';
  const deviceType = MOBILE_UA.test(ua) ? 'mobile' : 'desktop';
  response.headers.set('x-device-type', deviceType);

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|woff|woff2|ttf|eot)$).*)',
  ],
};
