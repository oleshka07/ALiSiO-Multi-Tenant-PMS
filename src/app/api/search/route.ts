/**
 * GET /api/search?q=… — одне поле, яким знаходиться будь-що.
 *
 * ── Чому це маршрут, а не модуль ────────────────────────────────────────
 *
 * Пошук за визначенням перетинає всі модулі, тож «модуль пошуку» був би
 * єдиним місцем, яке читає чужі таблиці — `guests`, `reservations`, `units`,
 * `invoices` — і ламався б від кожного перейменування колонки в чотирьох
 * модулях одразу. Тому шукає КОЖЕН модуль сам і віддає спільну форму
 * (`SearchHit`), а тут лише збірка й права.
 *
 * ── Права ───────────────────────────────────────────────────────────────
 *
 * Розділ не показується — і не ЗАПИТУЄТЬСЯ, — якщо права немає. Це різні
 * речі: зробити запит і відфільтрувати відповідь означало б читати дані,
 * яких людині бачити не можна, і покладатись на те, що вони не витечуть
 * дорогою. Тут вони просто не читаються.
 *
 * Порожня відповідь у розділі й відсутність розділу теж різні: перше каже
 * «немає такого гостя», друге не каже нічого. Тому розділ без права не
 * приходить порожнім — його немає в масиві зовсім.
 *
 * ── Чому екранів тут немає ──────────────────────────────────────────────
 *
 * Спершу вони тут були, і фільтрувались за правом «щоб назва екрана не
 * витекла». Це було самообманом: `core/navigation.ts` імпортує клієнтський
 * `AccountMenu`, тобто каталог і так лежить у бандлі браузера цілком.
 * Серверна фільтрація списку, який уже поїхав до людини, не приховує
 * нічого — вона лише виглядає як захист.
 *
 * Плюс вона ламала мову: `keywords` написані українською, а шукає людина
 * своєю. На клієнті є `t()`, тож чеський адміністратор набирає «DPH» і
 * знаходить «Фактурування». На сервері `t()` немає, і не мало б бути:
 * інваріант 19 тримає мову документів окремо від мови оператора саме тому,
 * що ці дві плутали.
 *
 * Отже, екрани шукаються в браузері (`GlobalSearch.tsx`), за правами, які
 * клієнт і так про себе знає. Тут лишились дані — там фільтрація за правом
 * справжня, бо самі дані на клієнт не потрапляють.
 *
 * ── Орендар ─────────────────────────────────────────────────────────────
 *
 * `withActor` ставить організацію на зʼєднання, і кожен провайдер додатково
 * отримує `actor.organizationId` параметром: на SQLite політик немає, і без
 * явної умови пошук у розробці бачив би всі готелі.
 */
import { NextResponse } from 'next/server';
import { withActor, type Actor } from '@core/auth/session';
import { hasPermission } from '@core/auth/permissions';
import { listFeatures } from '@core/features';
import { SEARCH_MIN_LENGTH, type SearchHit } from '@core/search-types';
import { searchGuests } from '@guests';
import { searchBookings } from '@bookings';
import { searchUnits } from '@properties';
import { searchInvoices } from '@finance';
import type { Permission } from '@core/auth/permissions';

interface Group {
  key: string;
  label: string;
  items: SearchHit[];
}

/**
 * Розділи пошуку, у порядку показу.
 *
 * Порядок не випадковий: на рецепції шукають бронь і гостя, а не фактуру.
 * `feature` — розділ зникає разом із вимкненим модулем, інакше пошук
 * знаходить те, чого в готелі немає.
 */
const SECTIONS: {
  key: string;
  label: string;
  permission: Permission;
  feature?: string;
  run: (term: string, organizationId: string) => Promise<SearchHit[]>;
}[] = [
  { key: 'bookings', label: 'Бронювання', permission: 'nav:bookings', run: searchBookings },
  { key: 'guests',   label: 'Гості',      permission: 'nav:guests',   run: searchGuests },
  { key: 'units',    label: 'Номери',     permission: 'nav:calendar', run: searchUnits },
  { key: 'invoices', label: 'Фактури',    permission: 'nav:documents', run: searchInvoices },
];

export const GET = withActor(async (request: Request, _ctx: unknown, actor: Actor) => {
  const term = (new URL(request.url).searchParams.get('q') || '').trim();
  if (term.length < SEARCH_MIN_LENGTH) return NextResponse.json({ groups: [] });

  const permissions = actor.user.permissions;
  const features = await listFeatures(actor.organizationId);

  const groups: Group[] = [];

  // Розділи по базі — паралельно: чотири незалежні запити, і послідовно вони
  // складали б свої затримки в одну, яку видно в полі вводу.
  const allowed = SECTIONS.filter((s) => hasPermission(permissions, s.permission))
    .filter((s) => !s.feature || features[s.feature as keyof typeof features]);

  const results = await Promise.allSettled(
    allowed.map((s) => s.run(term, actor.organizationId)),
  );

  results.forEach((r, i) => {
    const section = allowed[i];
    if (r.status === 'rejected') {
      // Один розділ, що впав, не має забирати решту: пошук без фактур
      // корисніший за порожній екран. Причина йде в лог, не гостю.
      console.error(`[search] ${section.key}:`, (r.reason as Error)?.message);
      return;
    }
    if (r.value.length) groups.push({ key: section.key, label: section.label, items: r.value });
  });

  return NextResponse.json({ groups });
});
