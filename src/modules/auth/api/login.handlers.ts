import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { verifyPassword, createSession } from '@core/auth';
import { runWithOrganization } from '@core/auth/tenant-context';

// ─── Login rate limiter (in-memory) ────────────────────────────────
//
// Counts FAILURES, not attempts. The previous version incremented on every
// call — before the password was even checked — so the sixth login of the
// quarter-hour was refused whether or not it was correct, and a success never
// cleared the counter. A hotel is one office behind one NAT address: reception,
// housekeeping and the owner share the budget, five logins spend it, and from
// then on the right password answers «Забагато спроб входу» exactly like the
// wrong one. Somebody then changes their password, tries again, is refused
// again, and concludes the account is broken. That is what this cost.
//
// A correct credential must never be refused by the thing guarding against
// wrong ones. So: only a failed login counts, a successful one wipes the
// address clean, and the budget is ten — brute force still dies here (bcrypt
// at cost 10 makes each guess expensive), a working colleague does not.
const loginFailures = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FAILURES = 10;

function isLockedOut(ip: string): boolean {
  const entry = loginFailures.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    loginFailures.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const entry = loginFailures.get(ip);
  if (!entry || now > entry.resetAt) {
    loginFailures.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  entry.count++;
}

/** A login that worked proves the address is not guessing. */
function clearFailures(ip: string): void {
  loginFailures.delete(ip);
}

// Cleanup stale entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginFailures) {
    if (now > entry.resetAt) loginFailures.delete(ip);
  }
}, 30 * 60 * 1000);

export async function login(request: Request) {
  try {
    // Rate limit by IP
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    if (isLockedOut(ip)) {
      return NextResponse.json(
        { error: 'Забагато невдалих спроб входу. Спробуйте через 15 хвилин.' },
        { status: 429 }
      );
    }

    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email та пароль обов'язкові" }, { status: 400 });
    }

    const sql = getSql();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // organization_id is selected because the write below needs it: this query
    // is the only thing that knows which tenant the person belongs to.
    const user: any = await sql.row<any>('SELECT id, organization_id, email, full_name, role, password_hash, is_active FROM app_users WHERE email = ?', [email]);

    if (!user) {
      recordFailure(ip);
      return NextResponse.json({ error: 'Невірний email або пароль' }, { status: 401 });
    }

    if (!user.is_active) {
      return NextResponse.json({ error: 'Обліковий запис деактивовано' }, { status: 403 });
    }

    if (!user.password_hash) {
      return NextResponse.json({ error: 'Пароль не встановлено. Зверніться до адміністратора.' }, { status: 403 });
    }

    const valid = verifyPassword(password, user.password_hash);
    if (!valid) {
      recordFailure(ip);
      return NextResponse.json({ error: 'Невірний email або пароль' }, { status: 401 });
    }

    // Right from here on the credential is proven. A deactivated account or a
    // missing hash above is a state the person already knows their password
    // for, so neither counts against them.
    clearFailures(ip);

    // As the organization, now that the lookup has revealed it. app_users opens
    // its READ side while no tenant is set — login could not find the row
    // otherwise — but the write side never opens, so this UPDATE was rejected
    // by the policy and login answered 500.
    await runWithOrganization(user.organization_id, () =>
      sql.run("UPDATE app_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", [user.id]));

    const sessionId = await createSession(user.id);

    const response = NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
    });
    response.cookies.set('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Помилка сервера' }, { status: 500 });
  }
}
