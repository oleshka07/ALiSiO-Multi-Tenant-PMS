import { getSql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';

/**
 * Тарифи обʼєкта — у тому вигляді, у якому їх треба знати модулю каналів.
 *
 * ── Навіщо шов ──────────────────────────────────────────────────────────
 *
 * Модуль каналів звертається тільки сюди і ніколи не читає тарифні таблиці
 * навпростець. Рішення «підняти тарифи на рівень обʼєкта чи лишити на сайті
 * продажів» свідомо НЕ ухвалене (ТЗ §3.5): робити цю міграцію до того, як
 * стане відомо, скільки тарифів реально продає готель, означає чіпати живі
 * дані наосліп. Коли рішення дозріє — змінюється ця функція плюс міграція, а
 * мапінг, батчер і адаптер цього не помічають.
 *
 * Умова, без якої шов не працює: така міграція мусить ЗБЕРЕГТИ id тарифів.
 * У `cm_mappings.local_id` лежать саме вони, і нові id означали б ручну
 * перебудову мапінгу в менеджері каналів по всіх готелях.
 *
 * ── Чому `rate_plans`, а не `site_rate_plans` ───────────────────────────
 *
 * ТЗ §3.5 писалося ДО міграції 0048, а вона поставила цінову вісь на
 * `rate_plans`: туди вказують і `price_calendar.rate_plan_id`, і
 * `reservations.rate_plan_id`. `site_rate_plans` не звʼязана з ними жодною
 * колонкою — її `derived_from_plan_id` вказує сама на себе.
 *
 * Тобто тарифи з `site_rate_plans` мали б id, яких немає в `price_calendar`:
 * кожен пошук ціни промахується, а `cm_mappings.local_id` тримає
 * ідентифікатори, які нічого не коштують.
 *
 * ── Дві осі, які в нас і в них влаштовані по-різному ────────────────────
 *
 * У нас тариф належить ОБʼЄКТУ, а вісь заселеності — ТИПУ номера
 * (`price_occupancy` ключується `unit_type_id`; інваріант 15). У менеджера
 * каналів тариф належить типу номера й носить заселеності в собі.
 *
 * Тому наша пара «тип × тариф» стає одним їхнім тарифом — і шов віддає типи
 * разом із тарифом, а не приховує їх. Розкладати цю пару на виклики API —
 * робота адаптера, не шва.
 */

/** Тип номера, на якому цей тариф продається. */
export interface RatePlanUnitType {
  id: string;
  code: string;
  name: string;
  /**
   * Заселеності, на які є ціна, — уже ОБРІЗАНІ місткістю типу.
   *
   * `price_occupancy` дозволяє завести четверту особу двомісному номеру:
   * база цього не забороняє. Менеджер каналів забороняє — заселеність понад
   * місткість типу відхиляється при створенні, і одна така помилка валить
   * синхронізацію всього каталогу. Тому обрізаємо тут, а не сподіваємось.
   */
  occupancies: number[];
  /** Скільки людей тип уміщає взагалі. */
  maxOccupancy: number;
}

export interface RatePlan {
  /** НАШ id — той самий, яким ключується `price_calendar`. */
  id: string;
  code: string;
  name: string;
  currency: string;
  cancellationPolicy: string | null;
  mealPlan: string | null;
  /** Типи номерів, на які цей тариф має ціну. Порожньо — його не продати. */
  unitTypes: RatePlanUnitType[];
  /**
   * Чи є що продавати.
   *
   * `false` означає «тариф заведено, але жодної ціни під нього немає»
   * (інваріант 17). Такий тариф ВІДДАЄТЬСЯ, а не викидається: мовчки
   * прибрати його зі списку означає лишити оператора з тарифом, який він
   * створив і не розуміє, чому той не працює. Але й у канал він не піде —
   * це вже рішення того, хто читає.
   */
  sellable: boolean;
}

/**
 * Тарифи обʼєкта, придатні до продажу через канал.
 *
 * Вимкнені (`is_active = false`) і приховані не повертаються взагалі: продати
 * через канал те, що готель вимкнув, — це бронь, якої він не чекає.
 *
 * Порожній список — нормальна відповідь для обʼєкта без тарифів і для чужого
 * обʼєкта. Друге не помилка виклику, а межа орендаря: `property_id` приходить
 * іззовні, тож обмеження тут явне, а не покладене на політику (на SQLite
 * політик немає, а SQLite стоїть у розробки й у CI).
 */
export async function propertyRatePlans(propertyId: string): Promise<RatePlan[]> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('rate plans: read without a tenant');

  const sql = getSql();

  const plans = await sql.rows<any>(
    `SELECT rp.id, rp.code, rp.name, rp.currency, rp.cancellation_policy, rp.meal_plan
       FROM rate_plans rp
       JOIN properties p ON p.id = rp.property_id
      WHERE rp.property_id = ? AND p.organization_id = ?
        AND rp.is_active = TRUE AND rp.is_hidden = FALSE
      ORDER BY rp.priority, rp.code`,
    [propertyId, organizationId],
  ) as Record<string, unknown>[];

  if (plans.length === 0) return [];

  // Типи номерів, на які тариф СПРАВДІ має ціну. Не декларація звʼязку —
  // її в схемі немає, — а те, що видно в ціновій таблиці. Тариф, під який
  // ніхто не поставив ціни, не продається (інваріант 17).
  const priced = await sql.rows<any>(
    `SELECT DISTINCT pc.rate_plan_id, ut.id AS unit_type_id, ut.code, ut.name, ut.max_occupancy
       FROM price_calendar pc
       JOIN unit_types ut ON ut.id = pc.unit_type_id
      WHERE ut.property_id = ? AND pc.rate_plan_id IS NOT NULL
      ORDER BY ut.code`,
    [propertyId],
  ) as Record<string, unknown>[];

  const occupancies = await sql.rows<any>(
    `SELECT DISTINCT po.unit_type_id, po.persons
       FROM price_occupancy po
       JOIN unit_types ut ON ut.id = po.unit_type_id
      WHERE ut.property_id = ?
      ORDER BY po.persons`,
    [propertyId],
  ) as Record<string, unknown>[];

  const byUnitType = new Map<string, number[]>();
  for (const row of occupancies) {
    const ut = String(row.unit_type_id);
    const persons = Number(row.persons);
    if (!Number.isFinite(persons) || persons < 1) continue;
    (byUnitType.get(ut) ?? byUnitType.set(ut, []).get(ut)!).push(persons);
  }

  const unitTypesOf = new Map<string, RatePlanUnitType[]>();
  for (const row of priced) {
    const planId = String(row.rate_plan_id);
    const unitTypeId = String(row.unit_type_id);
    const maxOccupancy = Number(row.max_occupancy) || 1;
    const list = unitTypesOf.get(planId) ?? unitTypesOf.set(planId, []).get(planId)!;
    list.push({
      id: unitTypeId,
      code: String(row.code),
      name: String(row.name),
      // Обрізання саме тут — див. коментар на полі.
      occupancies: (byUnitType.get(unitTypeId) ?? [])
        .filter((n) => n <= maxOccupancy)
        .sort((a, b) => a - b),
      maxOccupancy,
    });
  }

  return plans.map((row) => {
    const id = String(row.id);
    const unitTypes = unitTypesOf.get(id) ?? [];
    return {
      id,
      code: String(row.code),
      name: String(row.name),
      currency: String(row.currency),
      cancellationPolicy: row.cancellation_policy == null ? null : String(row.cancellation_policy),
      mealPlan: row.meal_plan == null ? null : String(row.meal_plan),
      unitTypes,
      sellable: unitTypes.length > 0,
    };
  });
}
