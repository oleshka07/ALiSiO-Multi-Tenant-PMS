/**
 * `POST /api/apps/guest/find` — «у мене є бронювання».
 *
 * ── Що цей маршрут віддає, і що НЕ віддає ───────────────────────────────
 *
 * Лише токен гостьової сторінки. Ні імені, ні дат, ні суми, ні номера
 * кімнати. Хто вгадав пару «телефон + імʼя» — зайшов; хто не вгадав — не
 * дізнався навіть того, чи існує така бронь. Це третя з чотирьох
 * властивостей, які роблять публічний пошук у персональних даних прийнятним
 * (`domain/lookup.ts`), і вона тут, а не в домені, бо саме ВІДПОВІДЬ її несе.
 *
 * Кіоск на ту саму пару віддає масковане імʼя і дати — і має право: він
 * стоїть у холі, поруч люди. Цей маршрут відкритий з будь-якого телефона.
 */
import { NextResponse } from 'next/server';
import { runWithOrganization } from '@core/auth/tenant-context';
import { handleError, refuse } from '@core/http/errors';
import { checkRateLimit } from '@core/security/rate-limit';
import { stayWindow } from '@/apps/kiosk/domain/search';
import { propertyByAppKey } from '../data/property.repo';
import { candidatesInWindow } from '../data/lookup.repo';
import { lookupOutcome, nameMatches, phoneTail } from '../domain/lookup';
import { readGuestAppKey } from '../domain/key';

/**
 * Хто стукає — для ліміту. Без адреси ключ стає одним відром на всіх, і це
 * чесніше за вигадану адресу (той самий довід, що в паруванні кіоска).
 */
function clientKey(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0].trim() : (request.headers.get('x-real-ip') ?? '');
  return `guest_lookup:${ip || 'unknown'}`;
}

/** Сьогодні за календарем сервера, `YYYY-MM-DD`. */
const today = () => new Date().toISOString().slice(0, 10);

export async function findStay(request: Request): Promise<Response> {
  try {
    // Ліміт — ПЕРШИМ, до читання тіла й до бази: маршрут мусить коштувати
    // спроби навіть тому, хто шле сміття. Десять невдач на чверть години.
    const limit = await checkRateLimit(clientKey(request), 'guest_lookup', 10, 15);
    if (!limit.allowed) refuse('Забагато спроб. Спробуйте за чверть години', 429);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = readGuestAppKey(body.key);
    // Ключа немає або він не ключ — 404, як і на самій сторінці: чужий і
    // вигаданий не відрізняються (інваріанти 5 і 8).
    if (!key) refuse('Не знайдено', 404);

    const home = await propertyByAppKey(key);
    if (!home) refuse('Не знайдено', 404);

    const tail = phoneTail(body.phone);
    const typedName = body.name;
    // Одна відповідь на «набрано казна-що» і на «не знайшли»: помилка, яка
    // їх розрізняє, — це спосіб промацати базу, а не допомога гостю.
    if (!tail || typeof typedName !== 'string' || !typedName.trim()) {
      return NextResponse.json({ found: false });
    }

    const window = stayWindow(today());
    const matches = await runWithOrganization(home.organizationId, async () => {
      const rows = await candidatesInWindow({
        organizationId: home.organizationId,
        propertyId: home.propertyId,
        from: window.from,
        to: window.to,
      });
      // Обидва чинники РАЗОМ. Телефон сам вгадується; телефон плюс імʼя — ні.
      return rows.filter((r) => phoneTail(r.phone) === tail
        && nameMatches(typedName, { firstName: r.firstName, lastName: r.lastName }));
    });

    const outcome = lookupOutcome(matches);
    if (outcome.kind === 'found') return NextResponse.json({ found: true, token: outcome.token });
    // Бронь є, гостьової сторінки немає — це ІНША порада гостю, ніж «перевірте
    // номер»: без окремого коду він шукав би помилку в тому, що набрав.
    if (outcome.kind === 'no_page') return NextResponse.json({ found: false, reason: 'no_page' });
    return NextResponse.json({ found: false });
  } catch (error) {
    return handleError('apps/guest findStay', error, 'Не вдалося виконати пошук');
  }
}
