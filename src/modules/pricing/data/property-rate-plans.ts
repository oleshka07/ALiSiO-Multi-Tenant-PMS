import { getSql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';
import type { SellMode } from '../domain/types';

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
   * Заселеності, які тариф ПРОДАЄ на цьому типі, — за режимом тарифу (Ц26),
   * і не вище за ДОРОСЛУ місткість типу.
   *
   * `per_room` — одна, на максимальну доросла місткість: у вендора «Per Room
   * Rate Plan … pass Occupancy Option for maximum occupancy», ціна однакова
   * на будь-яку кількість гостей. `per_person` — на кожну кількість дорослих,
   * для якої Є ДЖЕРЕЛО ЦІНИ: базова заселеність типу (її цінує сам тариф) і
   * ті кількості, які знає матриця на цьому типі, — не вище місткості.
   * До 05.09.2026 опція заводилась на кожну кількість до місткості, а ціну
   * без рядка матриці `priceNights` брав рівною ціні тарифу — четверо
   * дешевше за трьох (Ц26 (б), скасовано розділом A п.3). Опція без
   * джерела в каталог не йде: у вендора вона стояла б закритою назавжди.
   *
   * ── Чому саме дорослою, а не загальною ────────────────────────────────
   *
   * Бо опція заселеності в менеджера каналів за ОЗНАЧЕННЯМ про дорослих.
   * Виміряно на живому API 01.09.2026: тип «2 дорослих + 2 дітей» з опціями
   * 1..4 відповідає 422 «occupancy 3, 4 exceeds the room type's max adults
   * occupancy of 2», а 422 при створенні тарифу валить УВЕСЬ прохід
   * каталогу. Сімʼя 2+2 нічого не втрачає: опція 2 — правильна опція, а
   * дитина коштує стільки, скільки каже тариф (Ц12).
   */
  occupancies: number[];
  /** Скільки ДОРОСЛИХ уміщає тип. Саме це число обмежує вісь вище. */
  maxAdults: number;
  /** Скільки людей тип уміщає взагалі, разом із дітьми. Довідково. */
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
  /** Як рахує гостей (Ц26): задає набір опцій у вендора і те, чи є надбавка за заселеність. */
  sellMode: SellMode;
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
    `SELECT rp.id, rp.code, rp.name, rp.currency, rp.cancellation_policy, rp.meal_plan, rp.sell_mode
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
  //
  // «Має ціну» — це число більше за нуль, а не рядок. Рядок з `base_price`
  // NULL — це обмеження на день (0062), і пари з нього немає: пара, заведена
  // з такого рядка, стала б у вендора тарифом, якого готель не цінує, і який
  // батчер міг би лише закривати (Б3 листа Channex 05.09 — зайвий тариф
  // `505e5d24…` у каталозі тестового обʼєкта). Нуль сюди не потрапляє з 0062,
  // але межа названа явно: ціна — це `> 0`.
  const priced = await sql.rows<any>(
    `SELECT DISTINCT pc.rate_plan_id, ut.id AS unit_type_id, ut.code, ut.name,
            ut.max_adults, ut.max_occupancy, ut.base_occupancy
       FROM price_calendar pc
       JOIN unit_types ut ON ut.id = pc.unit_type_id
      WHERE ut.property_id = ? AND pc.rate_plan_id IS NOT NULL
        AND pc.base_price IS NOT NULL AND pc.base_price > 0
      ORDER BY ut.code`,
    [propertyId],
  ) as Record<string, unknown>[];

  const modeOf = new Map(plans.map((row) => [String(row.id), (row.sell_mode === 'per_room' ? 'per_room' : 'per_person') as SellMode]));

  // Кількості дорослих, які знає матриця, — по типу; рядок без типу — на всі
  // типи обʼєкта. Це джерело надбавки для «за особу», тож і межа опцій.
  const matrixRows = await sql.rows<any>(
    'SELECT DISTINCT unit_type_id, persons FROM price_occupancy WHERE property_id = ? AND organization_id = ?',
    [propertyId, organizationId],
  ) as { unit_type_id: string | null; persons: number }[];
  const knownAdults = (unitTypeId: string): number[] => matrixRows
    .filter((r) => r.unit_type_id == null || String(r.unit_type_id) === unitTypeId)
    .map((r) => Number(r.persons));

  const unitTypesOf = new Map<string, RatePlanUnitType[]>();
  for (const row of priced) {
    const planId = String(row.rate_plan_id);
    const unitTypeId = String(row.unit_type_id);
    const maxOccupancy = Number(row.max_occupancy) || 1;
    const maxAdults = Math.max(1, Number(row.max_adults) || 1);
    const baseOccupancy = Math.min(maxAdults, Math.max(1, Number(row.base_occupancy) || 2));
    const list = unitTypesOf.get(planId) ?? unitTypesOf.set(planId, []).get(planId)!;
    // Набір опцій задає РЕЖИМ тарифу, межа — ДОРОСЛА місткість (див. поле);
    // «за особу» — лише кількості з джерелом ціни: базова і ті, що в матриці.
    const perPerson = [...new Set([baseOccupancy, ...knownAdults(unitTypeId)])]
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= maxAdults)
      .sort((a, b) => a - b);
    list.push({
      id: unitTypeId,
      code: String(row.code),
      name: String(row.name),
      occupancies: modeOf.get(planId) === 'per_room' ? [maxAdults] : perPerson,
      maxAdults,
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
      sellMode: modeOf.get(id) ?? 'per_person',
      unitTypes,
      sellable: unitTypes.length > 0,
    };
  });
}
