/**
 * Область обʼєкта — який готель організації зараз на екрані.
 *
 * ── Що це і чого це НЕ є ────────────────────────────────────────────────
 *
 * Це презентація, не безпека. Орендар (організація) лежить на сесії й на
 * зʼєднанні (інваріанти 1 і 11); політики бази нічого про обʼєкт не знають
 * і не мають знати. Кука тут лише ПАМʼЯТАЄ останній вибір людини, щоб нова
 * вкладка відкрилась на тому самому готелі; вибір у самій вкладці живе в
 * адресі (`?property=`), і саме він головний — інакше дві вкладки на два
 * готелі ділили б одну куку і бились між собою.
 *
 * Значення куки — ідентифікатор обʼєкта, і читач звіряє його зі списком
 * обʼєктів організації: чужий або видалений обʼєкт означає «не памʼятаємо»,
 * а не помилку і не перший-ліпший (інваріант 13: перевірка, яка не знайшла
 * рядка, відмовляє).
 *
 * Читає `/api/auth/me` (список обʼєктів + запамʼятований), пише
 * `POST /api/auth/property`. Єдиний клієнтський читач — `PropertyScopeProvider`
 * (`src/ui/PropertyScopeContext.tsx`); тримає `check-property-scope.mjs`.
 */
import { cookies } from 'next/headers';
import { getSql } from '../db/async.ts';
import {
  ALL_PROPERTIES, ALL_PROPERTIES_PARAM, oneProperty, type PropertyScope,
} from '../property-scope.ts';
import { PropertyNotFound } from './tenant-context.ts';

export const PROPERTY_SCOPE_COOKIE = 'property_scope';

/** Імʼя параметра адреси — те саме, що читає провайдер у шапці. */
export const PROPERTY_PARAM = 'property';

/** Рік: вибір готелю не протухає сам — його змінює людина. */
export const PROPERTY_SCOPE_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * Запамʼятований обʼєкт, якщо він досі серед обʼєктів організації.
 * `ownedIds` — список із того самого запиту, що віддає обʼєкти клієнту:
 * другий запит до бази тут дав би дві відповіді на одне питання.
 */
export async function rememberedPropertyId(ownedIds: readonly string[]): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(PROPERTY_SCOPE_COOKIE)?.value?.trim();
  if (!raw) return null;
  return ownedIds.includes(raw) ? raw : null;
}

/**
 * Область обʼєкта ДЛЯ ЗАПИТУ — з адреси, а як її там немає, з памʼяті.
 *
 * ── Чому не просто `?property=` ─────────────────────────────────────────
 *
 * Бо його сьогодні ніхто не шле. Вісім екранів кличуть `/api/units` без
 * жодного параметра (`settings/units`, `calendar`, `bookings`,
 * `channel-manager`, `sites/[siteId]`, `BookingViewModal`, `MobileBookings`,
 * `MobileCalendar`) — вибір оператора живе в АДРЕСІ ВКЛАДКИ і в куці, і до
 * `fetch` не доходить. Вимагати параметр негайно означало б 400 на восьми
 * робочих екранах у рахунках із двома обʼєктами, тобто рівно в тих, заради
 * яких блок і робиться.
 *
 * Тому старшинство тут те саме, що в провайдері
 * (`src/ui/PropertyScopeContext.tsx`), і це не збіг, а вимога: два різні
 * порядки означали б, що шапка показує один обʼєкт, а список — інший.
 *
 *   1. `?property=<id|all>` — головне. Дві вкладки на два готелі не бʼються.
 *   2. кука `property_scope` — памʼятає останній вибір оператора.
 *   3. обʼєкт один — він і є область.
 *   4. інакше — «усі обʼєкти», і це те саме слово, яке в цю мить стоїть у
 *      шапці. Не «перший» і не мовчання: значення назване, його видно
 *      оператору, і воно потрапляє в запит типом.
 *
 * Обмеження, яке лишається і яке лікується не тут: доки `fetch` не несе
 * `?property=`, дві вкладки на два обʼєкти читають одну куку і покажуть той
 * самий обʼєкт. Це половина в теці інтерфейсу (`src/app`, `src/components`) —
 * по рядку на виклик.
 *
 * Чужий або видалений id у параметрі — 404, не «отже, всі» (інваріанти 5, 13).
 */
export async function actorPropertyScope(
  organizationId: string,
  requested?: string | null,
): Promise<PropertyScope> {
  const sql = getSql();
  const owned = (await sql.rows<{ id: string }>(
    'SELECT id FROM properties WHERE organization_id = ? ORDER BY created_at, id',
    [organizationId],
  )).map((r) => r.id);

  if (requested === ALL_PROPERTIES_PARAM) return ALL_PROPERTIES;
  if (requested) {
    if (!owned.includes(requested)) throw new PropertyNotFound();
    return oneProperty(requested);
  }

  const remembered = await rememberedPropertyId(owned);
  if (remembered) return oneProperty(remembered);
  if (owned.length === 1) return oneProperty(owned[0]);
  return ALL_PROPERTIES;
}

/** Те саме, але прямо з адреси запиту — щоб кожен хендлер не писав цих трьох рядків. */
export function requestedProperty(request: { url: string }): string | null {
  return new URL(request.url).searchParams.get(PROPERTY_PARAM);
}
