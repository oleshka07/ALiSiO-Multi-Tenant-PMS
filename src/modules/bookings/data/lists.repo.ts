/**
 * Чотири списки модуля броней: самі броні, канали продажу, платні послуги,
 * закриття номерів.
 *
 * ── Чому вони переїхали з хендлерів сюди ────────────────────────────────
 *
 * Кожен був рядком SQL просто в маршруті. Поки в них не було осі обʼєкта, це
 * було терпимо; щойно вісь зʼявилась, виявилось, що ЗАСВІДЧИТИ її нічим:
 * хендлери загорнуті у `withActor`, а той кличе `cookies()` — поза запитом
 * Next це виняток, тобто сцену на них не написати взагалі. Твердження, яке
 * неможливо запустити, це не твердження.
 *
 * Переїзд — рівно переїзд: жодного рядка SQL не змінено, змінилось лише те,
 * звідки він викликається. Хендлер лишає собі дві речі, які без запиту не
 * робляться: розбір адреси в область (`requestPropertyScope`) і відповідь.
 *
 * Заразом це те саме правило, що вже стоїть у `cleaning.repo.ts`: модуль не
 * пише SQL до чужих таблиць із маршруту, а питає двері.
 *
 * ── Одна колонка на дві осі ─────────────────────────────────────────────
 *
 * `booking_sources` і `additional_services` НЕ мають `organization_id` — до
 * орендаря вони дістаються ЛИШЕ через `property_id`. Тобто обидві осі тут
 * тримає одна колонка, і сплутати їх найлегше саме тут: `OWNED` звужує до
 * рахунку, `${inScope.sql}` — до будинку, і жодне з двох не заміняє інше.
 */
import { getSql } from '@core/db/async';
import { propertyScopeFilter, type PropertyScope } from '@core/property-scope';
import { CONFLICTING_SQL, CANCELLED_BY_CLIENT_SQL, orderByClause } from './list-filters';

/** Вісь ОРЕНДАРЯ через обʼєкт: «усі обʼєкти цього рахунку». Не вісь обʼєкта. */
const OWNED = (alias = '') => `${alias}property_id IN (SELECT id FROM properties WHERE organization_id = ?)`;

/**
 * Список броней — з фільтрами екрана.
 *
 * Область обʼєкта тут уже була (`?property_id=`), і вона працювала, але
 * приклеювалась ЗА МЕЖАМИ літерала (`query += ' AND r.property_id = ?'`), не
 * памʼятала вибір оператора з куки і на чужий id мовчки віддавала порожньо
 * замість 404. Тепер область приходить типом, а адресу розбирають двері
 * (`requestPropertyScope`) — до цього запиту вона доїжджає вже перевіреною.
 */
export async function listReservationRows(
  organizationId: string, scope: PropertyScope, searchParams: URLSearchParams,
) {
  const inScope = propertyScopeFilter(scope, 'r');

  const status = searchParams.get('status') || '';
  const category = searchParams.get('category') || '';
  const search = searchParams.get('search') || '';
  const excludeChildren = searchParams.get('exclude_children') === '1';

  let query = `
    SELECT
      r.id, r.check_in, r.check_out, r.nights, r.adults, r.children,
      r.status, r.payment_status, r.source, r.total_price, r.currency, r.notes, r.internal_notes, r.created_at, r.guest_page_token,
      r.parent_id, r.commission_amount,
      r.city_tax_amount, r.city_tax_included, r.city_tax_paid,
      r.registration_status, r.hostex_channel_type, r.hostex_reservation_code, r.external_uid,
      r.is_multi_room, r.multi_room_marker,
      r.utm_source, r.utm_medium, r.utm_campaign, r.utm_term, r.utm_content,
      -- Знижка їде списком, а не тільки детальним запитом: модалка бронювання
      -- відкривається з рядка списку, і без цих двох колонок вона показувала б
      -- «0 %» на броні, де знижка є, — і перший же blur затер би її.
      r.lodging_discount_percent, r.lodging_discount_reason,
      r.breakfast_included,
      -- Платник (0093): картка відкривається з рядка списку і показує, на
      -- кого документ, не чекаючи детального запиту.
      r.company_id, r.invoice_company_name,
      (SELECT COUNT(*) FROM reservation_sub_bookings WHERE reservation_id = r.id) as sub_booking_count,
      g.id as guest_id, g.first_name, g.last_name, g.email as guest_email, g.phone as guest_phone, g.nationality,
      u.id as unit_id, u.name as unit_name, u.code as unit_code, u.is_pool as unit_is_pool,
      c.id as category_id, c.name as category_name, c.type as category_type,
      ut.id as unit_type_id, ut.name as unit_type_name,
      r.property_id, p.name as property_name
    FROM reservations r
    JOIN guests g ON r.guest_id = g.id
    LEFT JOIN units u ON r.unit_id = u.id
    LEFT JOIN categories c ON u.category_id = c.id
    -- Тип береться від НОМЕРА, а якщо номера ще немає — від самої броні.
    --
    -- Бронь із каналу приходить із власним unit_type_id і без кімнати. Йти
    -- лише через units означало б показати рецепції «призначити номер», не
    -- сказавши ЯКОГО типу — тобто попросити зробити вибір і сховати єдине,
    -- що для нього потрібне.
    --
    -- (Без бектиків: увесь запит — шаблонний рядок JS.)
    LEFT JOIN unit_types ut ON ut.id = COALESCE(u.unit_type_id, r.unit_type_id)
    JOIN properties p ON r.property_id = p.id
    WHERE p.organization_id = ? AND ${inScope.sql}
  `;

  const params: string[] = [organizationId, ...inScope.params];

  // Hide child reservations on Bookings list page, but show them on Calendar
  if (excludeChildren) {
    query += ' AND r.parent_id IS NULL';
  }

  // Два незалежні фільтри: «без скасованих» звужує, «статус» звужує далі.
  // Раніше `else if` мовчки вимикав статус, щойно стояв exclude_cancelled.
  const excludeCancelled = searchParams.get('exclude_cancelled') === '1';
  if (excludeCancelled) {
    query += " AND r.status NOT IN ('cancelled', 'no_show')";
  }
  if (status) {
    query += ' AND r.status = ?';
    params.push(status);
  }

  if (category) {
    query += ' AND c.type = ?';
    params.push(category);
  }

  if (search) {
    // Код броні на боці каналу (BDC-…) — теж ключ пошуку: гість читає
    // його з листа Booking, а не називає прізвище.
    query += ` AND (
      g.first_name LIKE ? OR g.last_name LIKE ? OR
      (g.first_name || ' ' || g.last_name) LIKE ? OR
      u.name LIKE ? OR u.code LIKE ? OR r.id LIKE ? OR r.external_uid LIKE ?
    )`;
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like);
  }

  const paymentStatus = searchParams.get('payment_status') || '';
  if (paymentStatus) {
    query += ' AND r.payment_status = ?';
    params.push(paymentStatus);
  }

  const dateFrom = searchParams.get('date_from') || '';
  if (dateFrom) {
    query += ' AND r.check_in >= ?';
    params.push(dateFrom);
  }

  const dateTo = searchParams.get('date_to') || '';
  if (dateTo) {
    query += ' AND r.check_in <= ?';
    params.push(dateTo);
  }

  // Hide bookings already checked out before given date. Use this for
  // "current + upcoming" lists where stale departures are noise.
  const checkOutFrom = searchParams.get('check_out_from') || '';
  if (checkOutFrom) {
    query += ' AND r.check_out >= ?';
    params.push(checkOutFrom);
  }

  const sourceFilter = searchParams.get('source') || '';
  if (sourceFilter) {
    if (sourceFilter === 'widget') {
      query += " AND (r.source = 'widget' OR r.source LIKE 'widget:%')";
    } else {
      query += ' AND r.source = ?';
      params.push(sourceFilter);
    }
  }

  // Filter by specific unit (e.g. pool unit for staging strip)
  const unitIdFilter = searchParams.get('unit_id') || '';
  if (unitIdFilter) {
    query += ' AND r.unit_id = ?';
    params.push(unitIdFilter);
  }

  // Два фільтри-твердження (Блок 4 §2.5, форма — Hoteliera): «показати
  // конфліктні» — двом бронням продано одну кімнату на одну ніч;
  // «скасовані клієнтом» — скасування прийшло не з нашої стійки. Обидва
  // разом звужують, а не заміняють одне одного: кожен — свій `AND`.
  // SQL і його сцена — `list-filters.ts`.
  if (searchParams.get('conflicting') === '1') query += ` AND (${CONFLICTING_SQL})`;
  if (searchParams.get('cancelled_by') === 'client') query += ` AND (${CANCELLED_BY_CLIENT_SQL})`;

  query += orderByClause(searchParams.get('sort'), searchParams.get('dir'));

  return getSql().rows<Record<string, unknown>>(query, params);
}

/**
 * Канали продажу обʼєкта — з їхніми комісіями.
 *
 * Комісія належить БУДИНКУ: у двох готелів однієї компанії різні договори з
 * тим самим Booking, і спільний список запрошує правку не в тому рядку
 * (інваріант 29 — межа проходить по даних, а комісія це гроші).
 */
export async function listSourcesOf(organizationId: string, scope: PropertyScope) {
  const inScope = propertyScopeFilter(scope, 'bs');
  return getSql().rows<Record<string, unknown>>(
    `SELECT bs.* FROM booking_sources bs
      WHERE ${OWNED('bs.')} AND ${inScope.sql}
      ORDER BY bs.sort_order, bs.name`,
    [organizationId, ...inScope.params],
  );
}

/** Платні послуги обʼєкта — ціна в кожного будинку своя. */
export async function listServicesOf(organizationId: string, scope: PropertyScope) {
  const inScope = propertyScopeFilter(scope, '');
  return getSql().rows<Record<string, unknown>>(
    `SELECT * FROM additional_services
      WHERE ${OWNED()} AND ${inScope.sql}
      ORDER BY sort_order, name`,
    [organizationId, ...inScope.params],
  );
}

/**
 * Закриття номерів обʼєкта.
 *
 * Область береться від НОМЕРА, а не від денормалізованої колонки
 * `availability_blocks.organization_id`: вона NULLABLE, і рядки, вставлені до
 * її появи, лишились би невидимими власнику. Той самий довід, що вже стояв
 * тут для осі орендаря.
 */
export async function listBlocksOf(organizationId: string, scope: PropertyScope) {
  const inScope = propertyScopeFilter(scope, 'u');
  return getSql().rows<Record<string, unknown>>(
    `SELECT b.id, b.unit_id, b.date_from, b.date_to, b.reason, b.notes, b.hostex_code, b.created_at
       FROM availability_blocks b
       JOIN units u ON b.unit_id = u.id
      WHERE ${OWNED('u.')} AND ${inScope.sql}
      ORDER BY b.date_from ASC`,
    [organizationId, ...inScope.params],
  );
}

/**
 * Скільки чернеток чекає — число для бейджа на календарі й у бічному меню.
 *
 * ── Чому лічильник живе поруч зі списком ────────────────────────────────
 *
 * Шапка маршруту стверджує: «рахується те саме, що показує сторінка за
 * кліком». Це твердження про ДВА запити одразу, і тримати його можна лише
 * тримаючи їх поруч: клік веде на `/app/bookings?status=draft`, а той список —
 * `listReservationRows` двома функціями вище. Щойн сторінка взяла вісь
 * обʼєкта, бейдж без осі почав казати «7» там, де сторінка показує «3»; ламала
 * твердження не чиясь помилка, а переведення самої сторінки.
 *
 * Одна різниця між ними лишається НАВМИСНО і названа числом у сцені: бейдж не
 * рахує фальшивих броней, які вливає iCal (гість «OTA block»), а сторінка їх
 * показує. Це не розбіжність осі — це названий виняток.
 */
export async function countDraftsOf(organizationId: string, scope: PropertyScope) {
  const inScope = propertyScopeFilter(scope, 'r');
  const row = await getSql().row<{ count: number }>(
    `SELECT COUNT(*) as count FROM reservations r
       JOIN guests g ON g.id = r.guest_id
      WHERE ${OWNED('r.')} AND ${inScope.sql}
        AND r.status = 'draft'
        AND LOWER(g.first_name || ' ' || g.last_name) NOT LIKE '%ota%block%'
        AND LOWER(g.first_name || ' ' || g.last_name) NOT LIKE '%channel%block%'`,
    [organizationId, ...inScope.params],
  );
  return Number(row?.count || 0);
}
