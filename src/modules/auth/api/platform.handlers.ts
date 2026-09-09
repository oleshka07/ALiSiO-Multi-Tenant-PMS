/**
 * The supplier's own entrance — see core/auth/platform.ts for why it exists.
 *
 * Deliberately NOT reachable from the customer's login screen and not linked
 * from anywhere in the operator UI: a door that opens every hotel should not
 * be advertised on the one a receptionist uses.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSql } from '@core/db/async';
import { runWithOrganization } from '@core/auth/tenant-context';
import { setupProgressFor } from '@properties';
import {
  PLATFORM_COOKIE,
  createPlatformSession,
  deletePlatformSession,
  enterOrganization,
  getPlatformSession,
  leaveOrganization,
  verifyPlatformLogin,
} from '@core/auth/platform';

// ─── Failure-based rate limit ──────────────────────────────────────────────
// Same shape as the customer login: only wrong attempts count, a success
// clears the address. Tighter budget here — this credential opens every
// hotel, so five wrong guesses is already a story worth interrupting.
const failures = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
}

function lockedOut(ip: string): boolean {
  const entry = failures.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) { failures.delete(ip); return false; }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry || now > entry.resetAt) { failures.set(ip, { count: 1, resetAt: now + WINDOW_MS }); return; }
  entry.count++;
}

async function sessionFromCookie() {
  const store = await cookies();
  return await getPlatformSession(store.get(PLATFORM_COOKIE)?.value);
}

const unauthorized = () => NextResponse.json({ error: 'Не авторизовано' }, { status: 401 });

// ─── POST /api/platform/login ──────────────────────────────────────────────
export async function platformLogin(request: Request) {
  try {
    const ip = clientIp(request);
    if (lockedOut(ip)) {
      return NextResponse.json({ error: 'Забагато невдалих спроб входу. Спробуйте через 15 хвилин.' }, { status: 429 });
    }

    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email та пароль обов'язкові" }, { status: 400 });
    }

    const user = await verifyPlatformLogin(email, password);
    if (!user) {
      recordFailure(ip);
      return NextResponse.json({ error: 'Невірний email або пароль' }, { status: 401 });
    }
    failures.delete(ip);

    const sessionId = await createPlatformSession(user.id);
    const response = NextResponse.json({ success: true, email: user.email, full_name: user.full_name });
    response.cookies.set(PLATFORM_COOKIE, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60,
    });
    return response;
  } catch (error: any) {
    console.error('POST /api/platform/login error:', error?.message);
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 });
  }
}

// ─── POST /api/platform/logout ─────────────────────────────────────────────
export async function platformLogout() {
  const session = await sessionFromCookie();
  if (session) await deletePlatformSession(session.sessionId);
  const response = NextResponse.json({ success: true });
  response.cookies.set(PLATFORM_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return response;
}

// ─── GET /api/platform/me ──────────────────────────────────────────────────
export async function platformMe() {
  const session = await sessionFromCookie();
  if (!session) return unauthorized();

  let acting: { id: string; name: string } | null = null;
  if (session.actingOrganizationId) {
    const sql = getSql();
    const org: any = await sql.row<any>('SELECT id, name FROM organizations WHERE id = ?', [session.actingOrganizationId]);
    if (org) acting = { id: org.id, name: org.name };
  }
  return NextResponse.json({ email: session.email, full_name: session.fullName, acting });
}

// ─── GET /api/platform/organizations ───────────────────────────────────────
// The one query in the product that spans tenants, and it reads names and
// counts only — never a guest, a booking or a price. `organizations` carries
// no row-level policy for the same reason `sessions` does not: it is what the
// request consults before it knows which tenant it belongs to.
//
// Лічильники кожної організації читаються В ЇЇ контексті (`runWithOrganization`):
// `properties`, `cm_connections`, `booking_sites` — тенантні таблиці, і без
// контексту політика Postgres віддавала б для них нуль, тобто платформа
// показувала б «0 обʼєктів» кожному готелю. Колонки — за MASTER-PLAN §1.3:
// країна, валюта, обʼєктів, OTA, сайт, створено, Setup progress по першому
// обʼєкту. Це постачальник дивиться на свої готелі: назви й числа, і жодного
// гостя, броні чи ціни.
/**
 * Список РАХУНКІВ очима постачальника — свідомо без осі обʼєкта (INC-029).
 *
 * Тут кожен рядок це організація, а лічильники поруч (обʼєкти, користувачі,
 * підключені OTA, активні сайти) — властивість самого рахунку. Звузити їх
 * областю не можна навіть у принципі: постачальник дивиться на клієнта
 * цілком, а не з якогось одного його будинку, і жодної «шапки з обраним
 * обʼєктом» у нього немає.
 */
export async function platformOrganizations() {
  const session = await sessionFromCookie();
  if (!session) return unauthorized();

  const sql = getSql();
  const orgs = await sql.rows<any>(`
    SELECT o.id, o.name, o.slug, o.language, o.default_currency, o.created_at
    FROM organizations o
    ORDER BY o.name
  `);
  const rows = [];
  for (const o of orgs) {
    const detail = await runWithOrganization(String(o.id), async () => {
      const props = await sql.rows<any>('SELECT id, country FROM properties WHERE organization_id = ? ORDER BY created_at, id', [o.id]);
      const users = await sql.row<any>('SELECT COUNT(*) AS n FROM app_users WHERE organization_id = ?', [o.id]);
      const ota = await sql.row<any>('SELECT COUNT(*) AS n FROM cm_connections WHERE organization_id = ? AND is_enabled = TRUE', [o.id]);
      const site = await sql.row<any>(`SELECT COUNT(*) AS n FROM booking_sites WHERE organization_id = ? AND status = 'active'`, [o.id]);
      const first = props[0] ? String(props[0].id) : null;
      const progress = first ? await setupProgressFor(String(o.id), first) : null;
      const countries = [...new Set(props.map((p: any) => p.country).filter(Boolean))];
      return {
        properties: props.length,
        users: Number(users?.n ?? 0),
        country: countries.join(', ') || null,
        ota: Number(ota?.n ?? 0) > 0,
        site: Number(site?.n ?? 0) > 0,
        setup_done: progress?.done ?? 0,
        setup_total: progress?.total ?? 8,
      };
    });
    rows.push({ id: o.id, name: o.name, slug: o.slug, language: o.language, default_currency: o.default_currency, created_at: o.created_at, ...detail });
  }
  return NextResponse.json(rows);
}

// ─── POST /api/platform/enter ──────────────────────────────────────────────
export async function platformEnter(request: Request) {
  const session = await sessionFromCookie();
  if (!session) return unauthorized();

  const { organizationId } = await request.json();
  if (!organizationId) return NextResponse.json({ error: 'organizationId required' }, { status: 400 });

  const ok = await enterOrganization(session, organizationId, clientIp(request));
  if (!ok) return NextResponse.json({ error: 'Організацію не знайдено' }, { status: 404 });
  return NextResponse.json({ success: true });
}

// ─── POST /api/platform/leave ──────────────────────────────────────────────
export async function platformLeave(request: Request) {
  const session = await sessionFromCookie();
  if (!session) return unauthorized();
  await leaveOrganization(session, clientIp(request));
  return NextResponse.json({ success: true });
}
