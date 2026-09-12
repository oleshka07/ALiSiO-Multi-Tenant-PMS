/**
 * Скільки броней і гостей стоїть за кожною компанією-платником (Блок 4 §2.3).
 *
 * `reservations` належить bookings, тож і лічильник живе тут, а довідник
 * компаній питає його через `@bookings/kernel`. Один запит на організацію,
 * без N+1: список компаній — це десятки рядків, не тисячі.
 */
import { getSql } from '@core/db/async';
import { propertyScopeFilter, ALL_PROPERTIES } from '@core/property-scope';

/**
 * Обидва читачі тут — ПО ВСІХ обʼєктах рахунку, і це НАПИСАНО, а не
 * забуто (той самий прийом, що в `guests.repo`, рішення В11/Д52).
 *
 * Компанія-платник належить РАХУНКУ: `companies` не має `property_id`, бо
 * той самий контрагент замовляє номери в обох будинках власника. Звузити
 * значило б показувати в одному довіднику різні числа залежно від того, що
 * стоїть у шапці, при тому що сама компанія одна (INC-029).
 *
 * Раніше це було СПРАВЖНЬОЮ відсутністю фільтра з поясненням у коментарі,
 * тобто МОВЧАННЯМ: наступний читач не відрізнить його від забутої осі, і греп
 * по `ALL_PROPERTIES` цього місця не знаходив. Тепер рішення в КОДІ.
 */
const ACROSS_PROPERTIES = propertyScopeFilter(ALL_PROPERTIES, 'r');

export interface CompanyStayStats {
  reservations: number;
  guests: number;
  last_check_in: string | null;
}

/**
 * Лічильник свідомо БЕЗ осі обʼєкта (INC-029).
 *
 * `companies` не має `property_id`: компанія-платник належить РАХУНКУ, а не
 * будинку — той самий контрагент замовляє номери в обох. Звузити лічильник
 * означало б показувати в довіднику компаній різні числа залежно від того, що
 * стоїть у шапці, при тому що сама компанія одна.
 */
export async function companyStays(organizationId: string): Promise<Map<string, CompanyStayStats>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await getSql().rows<any>(
    // Гість приєднується і питається про орендаря — не для краси: лічильник
    // рахував `COUNT(DISTINCT r.guest_id)` за самим полем броні, тож рядок,
    // який вказує на гостя СУСІДА, збільшував число. Знайшлось гейтом
    // `company-guests.check`, коли список почав відсікати таке, а число — ні:
    // картка компанії казала «3 гостей» і показувала двох.
    //
    // На Postgres такого рядка не буде (ключ і політика), на SQLite не спиняє
    // ніщо — і саме тому умова в SQL. `LEFT JOIN` не годиться: він лишив би
    // чужий рядок у лічильнику, тобто нічого не змінив.
    `SELECT r.company_id, COUNT(*) AS reservations,
            COUNT(DISTINCT g.id) AS guests, MAX(r.check_in) AS last_check_in
       FROM reservations r
       JOIN properties p ON p.id = r.property_id
       JOIN guests g ON g.id = r.guest_id AND g.organization_id = ?
      WHERE p.organization_id = ? AND ${ACROSS_PROPERTIES.sql}
        AND r.company_id IS NOT NULL AND r.status <> 'cancelled'
      GROUP BY r.company_id`,
    [organizationId, ...ACROSS_PROPERTIES.params, organizationId]);
  const out = new Map<string, CompanyStayStats>();
  for (const r of rows) {
    out.set(String(r.company_id), {
      reservations: Number(r.reservations) || 0,
      guests: Number(r.guests) || 0,
      last_check_in: r.last_check_in ? String(r.last_check_in).slice(0, 10) : null,
    });
  }
  return out;
}

/** Один гість компанії — рівно те, що показує список у картці фірми. */
export interface CompanyGuest {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  /** Скільки разів ця фірма платила за цю людину. */
  stays: number;
  /** Останній заїзд за рахунок фірми — за ним список і впорядковано. */
  last_check_in: string | null;
}

/**
 * ХТО саме стоїть за лічильником «гостей» у картці компанії.
 *
 * ── Навіщо ──────────────────────────────────────────────────────────────
 *
 * `companyStays` рахує число, і воно було єдиним, що готель бачив: «12
 * гостей» без жодного способу дізнатись, хто вони. Власник сказав це прямо —
 * «не знайшов, як у компанії шукати гостей».
 *
 * ── Чому ВИВЕДЕНО з броней, а не колонка в `guests` ─────────────────────
 *
 * Спокуса завести `guests.company_id` була, і вона неправильна — причина
 * стоїть у `guests.repo`: рядок гостя юрособи не знає і не має знати.
 * Компанія тут — ПЛАТНИК, а не роботодавець: та сама людина цього разу їде
 * за рахунок фірми, наступного — своїм коштом, і третього — за рахунок
 * іншої фірми. Колонка змусила б обрати одну з трьох відповідей і назвати
 * її єдиною; виведення з броней відповідає на питання так, як воно
 * поставлене, і не старіє.
 *
 * ── Без осі обʼєкта, свідомо ────────────────────────────────────────────
 *
 * Та сама причина, що в `companyStays` (INC-029), і так само написана
 * дверима `ACROSS_PROPERTIES`, а не відсутністю фільтра: компанія належить
 * рахунку, а не будинку, тож звуження показувало б різних людей залежно
 * від того, що стоїть у шапці, при одній і тій самій фірмі.
 */
export async function companyGuests(
  organizationId: string,
  companyId: string,
): Promise<CompanyGuest[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await getSql().rows<any>(
    `SELECT g.id, g.first_name, g.last_name, g.email, g.phone,
            COUNT(*) AS stays, MAX(r.check_in) AS last_check_in
       FROM reservations r
       JOIN properties p ON p.id = r.property_id
       JOIN guests g ON g.id = r.guest_id
      WHERE p.organization_id = ? AND ${ACROSS_PROPERTIES.sql}
        AND g.organization_id = ?
        AND r.company_id = ?
        AND r.status <> 'cancelled'
      GROUP BY g.id, g.first_name, g.last_name, g.email, g.phone
      ORDER BY MAX(r.check_in) DESC`,
    // Орендар названий ДВІЧІ — і на будинку, і на гостеві. Не про всяк
    // випадок: `company_id` приходить з URL, і без другої умови чужий
    // ідентифікатор зібрав би імена й контакти гостей сусіда. На Postgres
    // від цього рятує політика, на SQLite (`npm run dev`) — ніщо.
    [organizationId, ...ACROSS_PROPERTIES.params, organizationId, companyId]);
}
