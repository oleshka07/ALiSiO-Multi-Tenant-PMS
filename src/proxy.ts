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
  // The channel manager's webhook. No session by definition: the token in
  // the URL names the connection (the policy opens that one row, migration
  // 0060) and the header secret opens the door — unknown token 404, wrong
  // secret 401, and nothing is done before the answer. Only the event name
  // is read from the body: the signal wakes a feed pull, the feed is the
  // truth (modules/channels/api/webhook.handlers.ts, DECISIONS Ц20).
  '/api/webhooks/',
  // Знімок бази Winhotel від агента на сервері готелю. Сесії немає за
  // визначенням — це планувальник Windows о третій ночі; право доводить
  // токен агента в заголовку (`<організація>.<секрет>`, хеш у
  // channel_credentials): невідомий токен 401, застосунок вимкнено 404, і
  // жоден байт не лягає на диск до цієї відповіді. Лише цей один шлях, не
  // `/api/apps/` цілком (src/apps/winhotel-import/api/snapshots.handlers.ts).
  '/api/apps/winhotel-import/snapshots',
  // Термінал самообслуговування в холі (Блок «Кіоск», 10.09.2026). Сесії
  // немає за визначенням: біля екрана стоїть ГІСТЬ, а не працівник готелю, і
  // входити нікому. Право доводить токен пристрою в `Authorization: Bearer`
  // (`<організація>.<пристрій>.<секрет>`, хеш у `kiosk_devices`): невідомий
  // або відкликаний токен 401, застосунок вимкнено 404. Виняток — обмін коду
  // парування на токен (`/pair`): токена там ще немає, і право доводить
  // шестизначний код, який тримають строк 10 хв, одноразовість і ліміт
  // частоти на IP.
  //
  // Тут увесь префікс, а не один шлях, як у Winhotel: у кіоска їх десяток —
  // пошук броні, реєстрація, підпис, заселення, виселення, події, — і всі
  // вони безсесійні за тією самою причиною.
  //
  // Ціна цього рішення названа: маршрути КАРТКИ застосунку лежать під тим
  // самим префіксом, тож і вони не дістають перенаправлення на вхід. Тому
  // вони зібрані під сегментом `/api/apps/kiosk/admin/`, який перелік
  // публічного в `check-route-guards` НЕ пропускає: варта в них
  // (`withOwner`) лишається обовʼязковою для гейта, а не для доброї волі.
  '/api/apps/kiosk/',
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

  // ─── The embed scripts, which live on OTHER people's websites ───────
  //
  // This prefix was never here, and the matcher below excludes svg, png,
  // css, woff… but not `.js`. So every file under /widget/ — embed.v2.js,
  // service-embed.js, collector.js, native-embed.js — answered 307 to
  // /app/login. A hotel's page loaded the tag, followed the redirect, and
  // executed an HTML login page as JavaScript. No widget rendered, no form
  // was collected, and the browser console said only that a script had
  // failed to parse.
  //
  // `/widget/embed.css` worked the whole time, because `css` is in the
  // matcher's exclusion list. That is why the widget looked like a styling
  // problem rather than a missing script.
  //
  // Public is not a concession here — it is the entire purpose. These files
  // are meant to be fetched by strangers' browsers from strangers' domains.
  // They carry no data: they build an iframe pointing at /w/<slug>, and
  // everything private stays behind the routes that iframe calls.
  '/widget/',
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
  // The external uptime monitor's probe. Public on purpose: it answers
  // {ok:true|false} and nothing else — proof the database is readable,
  // never a row of it. It exists so the monitor does not have to POST to
  // /api/auth/login, whose per-IP failed-login counter would lock the
  // monitor out for 15 minutes and turn the alert into a liar.
  '/api/health',
  '/api/admin/export-may',
  // The older embed URL. next.config.ts rewrites it onto /widget/embed.v2.js,
  // but this list is consulted first — and a hotel that installed the snippet
  // when that path was the published one cannot be asked to edit its website.
  '/embed.v2.js',
  // The PWA manifest, linked from the root layout: the browser fetches it on
  // /app/login too, where there is by definition no session yet.
  '/manifest.json',
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
