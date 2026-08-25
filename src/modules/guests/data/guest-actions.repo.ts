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
  // `booking_activity_log`, which is the table that exists. `reservation_activity`
  // never did — not in the SQLite schema and not in db/postgres/schema.sql — so
  // every guest who left feedback got an error and the text was lost. SQL is a
  // string, so nothing but running it says otherwise; the sibling handler in
  // bookings/api/reservation-activity.handlers.ts has always used the real name.
  await sql.run(`
    -- organization_id from the reservation: a guest carries no tenant of their
    -- own, and left to the column DEFAULT this row was NULL-tenanted on SQLite.
    INSERT INTO booking_activity_log (id, organization_id, reservation_id, action, details)
    VALUES (?, (SELECT organization_id FROM reservations WHERE id = ?), ?, 'guest_feedback', ?)
  `, [newId(), reservationId, reservationId, feedback.trim()]);
}

// ─── Service Orders ───────────────────────────────────────────────────────────

export async function getReservationForServiceOrder(token: string) {
  const sql = getSql();
  return await sql.row<any>('SELECT id, property_id FROM reservations WHERE guest_page_token = ?', [token]) as any;
}

/**
 * A guest orders a service from their own page.
 *
 * `propertyId` is not optional and the price lookup is joined to it, because
 * the service ids come from the guest's browser. Unqualified, this read the
 * price of whatever `additional_services` row carried that id — another
 * property's, at another property's price, and the order was then written
 * against this reservation. A hotel with a 5 € breakfast and a neighbour with
 * a 5 € sauna is not a hypothetical: the ids are handed to the page, and the
 * page is public to anyone holding the guest token.
 */
export async function orderServices(
  reservationId: string,
  propertyId: string,
  services: { serviceId: string; quantity?: number; notes?: string }[],
) {
  const sql = getSql();
  await sql.tx(async (t) => {
    for (const svc of services) {
      if (!svc.serviceId) throw new Error('serviceId is required');
      const service = await t.row<{ price: number }>(
        'SELECT price FROM additional_services WHERE id = ? AND property_id = ?',
        [svc.serviceId, propertyId]);
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
