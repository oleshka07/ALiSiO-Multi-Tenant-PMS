/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto';
import { getSql } from '@core/db/async';

// The id used to be defaulted by a SQLite-only blob function inside the
// INSERT. Same 32 lowercase hex chars, generated where both engines can.
const newId = () => crypto.randomBytes(16).toString('hex');

// ─── Feedback ─────────────────────────────────────────────────────────────────

export async function getReservationIdByToken(token: string): Promise<string | null> {
  const sql = getSql();
  const row = await sql.row<any>('SELECT id FROM reservations WHERE guest_page_token = ?', [token]) as any;
  return row?.id ?? null;
}

export async function saveFeedback(reservationId: string, feedback: string) {
  const sql = getSql();
  await sql.run(`
    INSERT INTO reservation_activity (id, reservation_id, type, description, created_by, created_at)
    VALUES (?, ?, 'guest_feedback', ?, 'guest', CURRENT_TIMESTAMP)
  `, [newId(), reservationId, feedback.trim()]);
}

// ─── Service Orders ───────────────────────────────────────────────────────────

export async function getReservationForServiceOrder(token: string) {
  const sql = getSql();
  return await sql.row<any>('SELECT id, property_id FROM reservations WHERE guest_page_token = ?', [token]) as any;
}

export async function orderServices(reservationId: string, services: { serviceId: string; quantity?: number; notes?: string }[]) {
  const sql = getSql();
  await sql.tx(async (t) => {
    for (const svc of services) {
      if (!svc.serviceId) throw new Error('serviceId is required');
      const service = await t.row<{ price: number }>('SELECT price FROM additional_services WHERE id = ?', [svc.serviceId]);
      if (!service) throw new Error(`Service ${svc.serviceId} not found`);
      const qty = svc.quantity || 1;
      await t.run(
        'INSERT INTO service_orders (reservation_id, service_id, quantity, total_price, notes) VALUES (?, ?, ?, ?, ?)',
        [reservationId, svc.serviceId, qty, service.price * qty, svc.notes ?? null],
      );
    }
  });

  return await sql.rows<any>(`
    SELECT so.*, ads.name as service_name, ads.icon as service_icon
    FROM service_orders so
    JOIN additional_services ads ON so.service_id = ads.id
    WHERE so.reservation_id = ?
    ORDER BY so.created_at
  `, [reservationId]);
}

// ─── Pay (service order + Teya) ───────────────────────────────────────────────

export async function getReservationForPay(token: string) {
  const sql = getSql();
  return await sql.row<any>(`
    SELECT r.id, p.organization_id, r.property_id, r.check_in, r.check_out,
           r.is_multi_room, r.multi_room_marker,
           g.first_name, g.last_name, u.name as unit_name
    FROM reservations r
    JOIN properties p ON r.property_id = p.id
    JOIN guests g ON r.guest_id = g.id
    JOIN units u ON r.unit_id = u.id
    WHERE r.guest_page_token = ?
      AND r.status IN ('confirmed', 'checked_in')
      AND r.payment_status IN ('paid','prepaid','partial')
  `, [token]) as any;
}

export async function getServiceForProperty(serviceId: string, propertyId: string) {
  const sql = getSql();
  return await sql.row<any>('SELECT * FROM additional_services WHERE id = ? AND property_id = ? AND is_active = TRUE', [serviceId, propertyId]) as any;
}

export async function createPendingServiceOrder(
  reservationId: string,
  serviceId: string,
  quantity: number,
  totalPrice: number,
  serviceDate?: string | null,
  notesJson?: string | null,
): Promise<string> {
  const sql = getSql();
  const result = await sql.row<any>(`
    INSERT INTO service_orders (reservation_id, service_id, quantity, total_price, status, payment_status, service_date, notes)
    VALUES (?, ?, ?, ?, 'pending', 'pending', ?, ?)
    RETURNING id
  `, [reservationId, serviceId, quantity, totalPrice, serviceDate || null, notesJson || null]) as any;
  return result?.id;
}

// Create one booking_service_orders row per (menu item × selected day).
// Used for breakfast cart-bundle payments — the cart line carries an
// array of menu items + dates; backend fans them out to per-row records
// so the dashboard groups breakfasts on the morning they are delivered.
export async function createPendingBreakfastBundle(
  reservationId: string,
  menuItems: Array<{ menuItemId: string; quantity: number; price: number }>,
  serviceDates: string[],
): Promise<string[]> {
  const sql = getSql();
  const ids: string[] = [];
  await sql.tx(async (t) => {
    for (const date of serviceDates) {
      for (const it of menuItems) {
        const row = await t.row<{ id: string }>(`
          INSERT INTO booking_service_orders
            (reservation_id, service_id, menu_item_id, quantity, service_date, unit_price, total_price, status, payment_status)
          VALUES (?, 'svc_breakfast', ?, ?, ?, ?, ?, 'pending', 'pending')
          RETURNING id
        `, [reservationId, it.menuItemId, it.quantity, date, it.price, it.price * it.quantity]);
        if (row?.id) ids.push(row.id);
      }
    }
  });
  return ids;
}

export async function updateBookingServiceOrderPaymentId(orderId: string, paymentId: string) {
  const sql = getSql();
  await sql.run('UPDATE booking_service_orders SET payment_id = ? WHERE id = ?', [paymentId, orderId]);
}

export async function updateOrderPaymentId(orderId: string, paymentId: string) {
  const sql = getSql();
  await sql.run('UPDATE service_orders SET payment_id = ? WHERE id = ?', [paymentId, orderId]);
}

export async function markOrderPaymentFailed(orderId: string) {
  const sql = getSql();
  await sql.run("UPDATE service_orders SET payment_status = 'failed' WHERE id = ?", [orderId]);
}

// ─── Cart Events ──────────────────────────────────────────────────────────────

export interface CartEventInput {
  reservationId?: string | null;
  guestToken: string;
  serviceId?: string | null;
  eventType: 'add' | 'remove' | 'pay_now' | 'checkout' | 'abandon';
  quantity?: number;
  phase?: string | null;
  cartTotal?: number | null;
  itemsJson?: string | null;
}

export async function logCartEvent(data: CartEventInput): Promise<string> {
  const sql = getSql();
  const result = await sql.row<any>(`
    INSERT INTO cart_events
      (reservation_id, guest_token, service_id, event_type, quantity, phase, cart_total, items_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `, [data.reservationId ?? null,
    data.guestToken,
    data.serviceId ?? null,
    data.eventType,
    data.quantity ?? 1,
    data.phase ?? null,
    data.cartTotal ?? null,
    data.itemsJson ?? null]) as any;
  return result?.id;
}

/** Find abandon events older than minMinutes that have NOT been notified yet,
 *  skipping cancelled/no_show reservations to avoid spamming guests unnecessarily */
export async function getPendingAbandonNotifications(guestToken: string, minMinutes = 30) {
  const sql = getSql();
  return await sql.row<any>(`
    SELECT ce.*, g.email as guest_email, g.first_name, g.last_name,
           r.check_in, r.check_out, u.name as unit_name
    FROM cart_events ce
    LEFT JOIN reservations r ON ce.reservation_id = r.id
    LEFT JOIN guests g ON r.guest_id = g.id
    LEFT JOIN units u ON r.unit_id = u.id
    WHERE ce.guest_token = ?
      AND ce.event_type = 'abandon'
      AND ce.abandon_notified_at IS NULL
      AND ce.created_at <= ${sql.dialect.plusMinutes('CURRENT_TIMESTAMP', '-1 * ?')}
      AND (r.id IS NULL OR r.status NOT IN ('cancelled','no_show'))
    ORDER BY ce.created_at DESC
    LIMIT 1
  `, [guestToken, minMinutes]) as any;
}

export async function markAbandonNotified(eventId: string) {
  const sql = getSql();
  await sql.run("UPDATE cart_events SET abandon_notified_at = CURRENT_TIMESTAMP WHERE id = ?", [eventId]);
}

/** Batch-fetch services by IDs for a given property */
export async function getServicesForCart(serviceIds: string[], propertyId: string) {
  const sql = getSql();
  if (!serviceIds.length) return [];
  const placeholders = serviceIds.map(() => '?').join(',');
  return await sql.rows<any>(`SELECT id, name, name_en, price, currency, icon FROM additional_services
     WHERE id IN (${placeholders}) AND property_id = ? AND is_active = TRUE`, [...serviceIds, propertyId]) as any[];
}
