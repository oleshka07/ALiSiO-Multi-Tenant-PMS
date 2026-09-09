/**
 * Замовлення послуг на день або тиждень — два джерела, один екран.
 *
 * ── Чому два запити, а не один ──────────────────────────────────────────
 *
 * Замовлення приходять двома шляхами і лежать у двох таблицях:
 * `booking_service_orders` — те, що купили у віджеті (може не мати броні
 * взагалі: заходень купує сауну без проживання), `service_orders` — те, що
 * замовили з гостьової сторінки, і воно завжди висить на броні. Обʼєднати їх
 * `UNION`-ом означало б зрівняти колонки, яких в одного немає.
 *
 * ── Звідки береться обʼєкт ──────────────────────────────────────────────
 *
 * Із РІЗНИХ місць, і це не недогляд:
 *
 *   віджетне замовлення → `additional_services.property_id` — послугу продає
 *     конкретний будинок, і замовлення без броні іншого якоря не має;
 *   гостьове замовлення → `reservations.property_id` — воно завжди на броні,
 *     і будинок беремо від неї.
 *
 * Той самий довід, що для осі орендаря в цьому ж файлі до INC-029: орендар
 * теж діставався двома шляхами з тієї самої причини.
 *
 * ── Чому SQL переїхав із хендлера ───────────────────────────────────────
 *
 * `withActor` кличе `cookies()`: поза запитом Next це виняток, тобто сцени на
 * хендлер не буває. Розкладка рядків у форму екрана лишилась там — вона не
 * SQL і осі не стосується.
 */
import { getSql } from '@core/db/async';
import { propertyScopeFilter, type PropertyScope } from '@core/property-scope';

/** Вікно екрана: день, тиждень або «усе». */
export interface OrdersWindow {
  period: string;
  dateParam: string;
  dateTo: string;
}

/** Орендар через обʼєкт: «усі обʼєкти цього рахунку». Не вісь обʼєкта. */
const OWNED = (column: string) => `${column} IN (SELECT id FROM properties WHERE organization_id = ?)`;

const windowFilter = (w: OrdersWindow, column: string) => (w.period === 'day'
  ? { sql: `AND ${column} = ?`, params: [w.dateParam] }
  : w.period === 'week'
    ? { sql: `AND ${column} >= ? AND ${column} <= ?`, params: [w.dateParam, w.dateTo] }
    : { sql: '', params: [] as string[] });

export async function widgetServiceOrdersOf(
  organizationId: string, scope: PropertyScope, w: OrdersWindow,
) {
  const when = windowFilter(w, 'bso.service_date');
  const inScope = propertyScopeFilter(scope, 'ads');
  return getSql().rows<Record<string, unknown>>(`
    SELECT
      bso.id, bso.reservation_id, bso.service_id, bso.quantity,
      bso.service_date, bso.options_json, bso.unit_price, bso.total_price,
      bso.status, bso.payment_status, bso.coupon_code, bso.created_at,
      bso.completed_at, bso.menu_item_id,
      ads.name as service_name, ads.name_en, ads.service_type,
      mi.name_en as menu_item_name,
      g.first_name, g.last_name,
      u.name as unit_name
    FROM booking_service_orders bso
    JOIN additional_services ads ON bso.service_id = ads.id
    LEFT JOIN menu_items mi ON bso.menu_item_id = mi.id
    LEFT JOIN reservations r ON bso.reservation_id = r.id
    LEFT JOIN guests g ON r.guest_id = g.id
    LEFT JOIN units u ON r.unit_id = u.id
    WHERE 1=1 ${when.sql} AND ${OWNED('ads.property_id')} AND ${inScope.sql}
      AND bso.status != 'cancelled'
      AND bso.payment_status NOT IN ('failed', 'refunded')
    ORDER BY bso.service_date ASC, bso.created_at DESC
  `, [...when.params, organizationId, ...inScope.params]);
}

export async function guestServiceOrdersOf(
  organizationId: string, scope: PropertyScope, w: OrdersWindow,
) {
  const when = windowFilter(w, 'COALESCE(so.service_date, r.check_in)');
  const inScope = propertyScopeFilter(scope, 'r');
  return getSql().rows<Record<string, unknown>>(`
    SELECT
      so.id, so.reservation_id, so.service_id, so.quantity,
      so.total_price, so.status, so.payment_status, so.created_at,
      so.service_date, so.notes,
      ads.name as service_name, ads.name_en, ads.service_type,
      g.first_name, g.last_name,
      u.name as unit_name,
      r.check_in
    FROM service_orders so
    JOIN additional_services ads ON so.service_id = ads.id
    JOIN reservations r ON so.reservation_id = r.id
    JOIN guests g ON r.guest_id = g.id
    LEFT JOIN units u ON r.unit_id = u.id
    WHERE 1=1 ${when.sql}
      AND r.organization_id = ? AND ${inScope.sql}
      AND so.status != 'cancelled'
      AND so.payment_status NOT IN ('failed', 'refunded')
    ORDER BY so.created_at DESC
    LIMIT 50
  `, [...when.params, organizationId, ...inScope.params]);
}
