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
  ALL_PROPERTIES, ALL_PROPERTIES_PARAM, oneProperty, requestedPropertyParam,
  type PropertyScope,
} from '../property-scope.ts';
import { PropertyNotFound } from './tenant-context.ts';

export const PROPERTY_SCOPE_COOKIE = 'property_scope';

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
 * Область обʼєкта ДЛЯ ЗАПИТУ — те, що сказав виклик, а як не сказав, то памʼять.
 *
 * ── Дві назви одного, і обидві справжні ─────────────────────────────────
 *
 * У коді вже живуть ДВА імені цієї осі, і жодне не помилка:
 *
 *   `?property=<id|all>`  — АДРЕСА ВКЛАДКИ. Її пише провайдер у шапці
 *                           (`src/ui/PropertyScopeContext.tsx`), і саме її
 *                           пересилають колезі;
 *   `?property_id=<id>`   — FETCH. Так уже питають чотирнадцять екранів
 *                           (`/api/reports`, `/api/dashboard`,
 *                           `/api/pricing/*`, `/api/settings/*`), беручи
 *                           значення з того самого `usePropertyScope()`.
 *
 * Тому читаються обидва, `property_id` першим — це те, що шлють; звести їх до
 * одного імені означало б переписати чотирнадцять чужих екранів заради
 * охайності. Розбіжність названа в NAMING §8.
 *
 * ── Старшинство ─────────────────────────────────────────────────────────
 *
 * Те саме, що в провайдері, і це вимога, а не збіг: два різні порядки
 * означали б, що шапка показує один обʼєкт, а список — інший.
 *
 *   1. параметр запиту — `all` або порожній рядок означають «усі обʼєкти»
 *      СКАЗАНО (саме так екрани пишуть «Усі»: `propertyId ? …id=… : ''`);
 *      id — один обʼєкт, і він звіряється на власність;
 *   2. кука `property_scope` — памʼятає останній вибір оператора;
 *   3. обʼєкт один — він і є область, обирати нема з чого;
 *   4. інакше — «усі обʼєкти», і це те саме слово, яке в цю мить стоїть у
 *      шапці. Не «перший» і не мовчання.
 *
 * Обмеження, яке лишається і яке лікується не тут: виклик, який не несе
 * параметра взагалі (вісім читачів `/api/units`), спирається на куку, а кука
 * одна на всі вкладки — саме той випадок, заради якого провайдер зробив
 * адресу головнішою за куку. По рядку на виклик, і всі вони в теці
 * інтерфейсу.
 *
 * Чужий або видалений id — 404, не «отже, всі» (інваріанти 5, 13).
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

  // `null` — параметра не було взагалі; `''` і `all` — «усі» сказано словом.
  if (requested === ALL_PROPERTIES_PARAM || requested === '') return ALL_PROPERTIES;
  if (requested) {
    if (!owned.includes(requested)) throw new PropertyNotFound();
    return oneProperty(requested);
  }

  const remembered = await rememberedPropertyId(owned);
  if (remembered) return oneProperty(remembered);
  if (owned.length === 1) return oneProperty(owned[0]);
  return ALL_PROPERTIES;
}

/** Область прямо із запиту — те, що потрібно майже кожному читачу. */
export async function requestPropertyScope(
  request: { url: string },
  organizationId: string,
): Promise<PropertyScope> {
  return actorPropertyScope(organizationId, requestedPropertyParam(request.url));
}
