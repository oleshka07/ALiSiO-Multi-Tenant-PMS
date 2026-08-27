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

    const { email, password, organizationId } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email та пароль обов'язкові" }, { status: 400 });
    }

    const sql = getSql();
    // Усі рядки з цією адресою, а не перший-ліпший.
    //
    // Одна людина може бути власником у кількох готелях — і на робочій базі
    // така вже є. А `sql.row()` без ORDER BY повертає ОДИН рядок, і завжди той
    // самий: другий акаунт із дня створення не міг увійти жодного разу, з
    // правильним паролем, і без жодного повідомлення про причину. Порожній
    // last_login на такому рядку — слід саме цього, а не «ним не
    // користувались».
    //
    // Email порівнюється без огляду на регістр: ніхто не набирає власну адресу
    // однаково двічі, `provisionOrganization` пише її в нижньому, а рядки,
    // створені до нормалізації, лежать так, як їх набрали. Тому lower() з обох
    // боків.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidates = await sql.rows<any>(
      `SELECT u.id, u.organization_id, u.email, u.full_name, u.role, u.password_hash, u.is_active,
              o.name AS organization_name
         FROM app_users u
         LEFT JOIN organizations o ON o.id = u.organization_id
        WHERE lower(u.email) = lower(?)
        ORDER BY u.created_at`,
      [String(email).trim()]) as any[];

    if (candidates.length === 0) {
      recordFailure(ip);
      return NextResponse.json({ error: 'Невірний email або пароль' }, { status: 401 });
    }

    // Пароль звіряється з КОЖНИМ кандидатом, бо в різних готелях він може бути
    // різний. Це навмисно робиться до того, як назвати хоч один готель:
    // інакше сторонній дізнавався б із форми входу, у скількох готелях є така
    // адреса і як вони звуться.
    //
    // Кандидатів обмежено: bcrypt коштує ~100 мс на звірку, і це його робота.
    // Реальне число — один-два; стеля тут лише щоб довгий список не став
    // способом навантажити сервер.
    const MAX_CANDIDATES = 10;
    const matched = candidates.slice(0, MAX_CANDIDATES)
      .filter((c) => c.password_hash && verifyPassword(password, c.password_hash));

    if (matched.length === 0) {
      // Деактивований акаунт або акаунт без пароля — це стан, про який людина
      // вже знає свій пароль, тож він не має рахуватись невдалою спробою.
      const inactive = candidates.find((c) => !c.is_active);
      if (inactive) {
        return NextResponse.json({ error: 'Обліковий запис деактивовано' }, { status: 403 });
      }
      if (candidates.some((c) => !c.password_hash)) {
        return NextResponse.json({ error: 'Пароль не встановлено. Зверніться до адміністратора.' }, { status: 403 });
      }
      recordFailure(ip);
      return NextResponse.json({ error: 'Невірний email або пароль' }, { status: 401 });
    }

    const active = matched.filter((c) => c.is_active);
    if (active.length === 0) {
      return NextResponse.json({ error: 'Обліковий запис деактивовано' }, { status: 403 });
    }

    // Готель обрано другим запитом — або він один і питати нема про що.
    const chosen = organizationId
      ? active.find((c) => c.organization_id === organizationId)
      : (active.length === 1 ? active[0] : null);

    if (!chosen) {
      if (organizationId) {
        // Пароль правильний, але для названого готелю такого акаунта немає.
        recordFailure(ip);
        return NextResponse.json({ error: 'Невірний email або пароль' }, { status: 401 });
      }
      // Пароль уже доведено, тож назвати готелі можна: це список того, куди
      // ця людина й так може увійти. Сесії ще немає — вона зʼявиться, коли
      // форма повернеться з organizationId.
      clearFailures(ip);
      return NextResponse.json({
        needsOrganization: true,
        organizations: active.map((c) => ({
          id: c.organization_id,
          name: c.organization_name || c.organization_id,
          role: c.role,
        })),
      });
    }

    const user = chosen;

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
