/**
 * Booking.com Reservations Pull Client
 * 
 * Pulls reservations from Booking.com via OTA XML (every 20 seconds).
 * Handles: new bookings, modifications, cancellations.
 * Acknowledges each reservation after processing.
 */

import { getDb } from '@/lib/db';
import { authenticatedFetch } from '../auth';
import { withRateLimit } from '../rate-limiter';
import { logSyncRequest, extractRUID } from '../ruid-logger';
import { buildResNotifAcknowledge, buildReservationSummaryRequest } from '../xml/ota-builder';
import { parseResNotifResponse } from '../xml/ota-parser';
import { enqueueForAllConnections } from '../sync-queue';
import { BOOKING_COM_URLS } from '../types';
import type { OTAReservation, EnvironmentType } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Pull new reservations from Booking.com
 */
export async function pullNewReservations(connectionId: string): Promise<OTAReservation[]> {
  const env = getEnvironmentForConn(connectionId);
  const baseUrl = BOOKING_COM_URLS[env].secureSupply;
  const endpoint = `${baseUrl}/ota/OTA_HotelResNotif`;

  const startTime = Date.now();
  let ruid: string | null = null;
  let responseStatus: number | undefined;
  let responseBody: string | undefined;

  try {
    const response = await withRateLimit('/ota/OTA_HotelResNotif', async () => {
      return authenticatedFetch(connectionId, endpoint, {
        method: 'GET',
        headers: { 'Accept': 'application/xml' },
        signal: AbortSignal.timeout(5 * 60 * 1000), // 5 min timeout per Booking.com docs
      });
    });

    responseStatus = response.status;
    ruid = extractRUID(response.headers);
    responseBody = await response.text();

    if (!response.ok) {
      console.error(`[Reservations] Pull failed: HTTP ${response.status}`);
      return [];
    }

    return parseResNotifResponse(responseBody);
  } catch (error: any) {
    console.error(`[Reservations] Pull error:`, error.message);
    return [];
  } finally {
    logSyncRequest({
      connectionId,
      direction: 'inbound',
      endpoint: '/ota/OTA_HotelResNotif',
      responseStatus: responseStatus ?? null,
      responseBody: responseBody ?? null,
      ruid,
      durationMs: Date.now() - startTime,
    });
  }
}

/**
 * Acknowledge processed reservations (POST back to Booking.com)
 */
export async function acknowledgeReservations(
  connectionId: string,
  reservationIds: string[],
): Promise<boolean> {
  if (reservationIds.length === 0) return true;

  const env = getEnvironmentForConn(connectionId);
  const baseUrl = BOOKING_COM_URLS[env].secureSupply;
  const endpoint = `${baseUrl}/ota/OTA_HotelResNotif`;

  const xmlBody = buildResNotifAcknowledge(reservationIds);
  const startTime = Date.now();

  try {
    const response = await withRateLimit('/ota/OTA_HotelResNotif', async () => {
      return authenticatedFetch(connectionId, endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml', 'Accept': 'application/xml' },
        body: xmlBody,
      });
    });

    const responseBody = await response.text();
    const ruid = extractRUID(response.headers);

    logSyncRequest({
      connectionId,
      direction: 'outbound',
      endpoint: '/ota/OTA_HotelResNotif (ACK)',
      requestBody: xmlBody,
      responseStatus: response.status,
      responseBody,
      ruid,
      durationMs: Date.now() - startTime,
    });

    return response.ok;
  } catch (error: any) {
    console.error(`[Reservations] Acknowledge error:`, error.message);
    return false;
  }
}

/**
 * Pull modifications and cancellations
 */
export async function pullModifications(connectionId: string): Promise<OTAReservation[]> {
  const env = getEnvironmentForConn(connectionId);
  const baseUrl = BOOKING_COM_URLS[env].secureSupply;
  const endpoint = `${baseUrl}/ota/OTA_HotelResModifyNotif`;

  const startTime = Date.now();

  try {
    const response = await withRateLimit('/ota/OTA_HotelResModifyNotif', async () => {
      return authenticatedFetch(connectionId, endpoint, {
        method: 'GET',
        headers: { 'Accept': 'application/xml' },
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
    });

    const responseBody = await response.text();
    const ruid = extractRUID(response.headers);

    logSyncRequest({
      connectionId,
      direction: 'inbound',
      endpoint: '/ota/OTA_HotelResModifyNotif',
      responseStatus: response.status,
      responseBody,
      ruid,
      durationMs: Date.now() - startTime,
    });

    if (!response.ok) return [];
    return parseResNotifResponse(responseBody);
  } catch (error: any) {
    console.error(`[Reservations] Modifications pull error:`, error.message);
    return [];
  }
}

/**
 * Acknowledge modifications/cancellations
 */
export async function acknowledgeModifications(
  connectionId: string,
  reservationIds: string[],
): Promise<boolean> {
  if (reservationIds.length === 0) return true;

  const env = getEnvironmentForConn(connectionId);
  const baseUrl = BOOKING_COM_URLS[env].secureSupply;
  const endpoint = `${baseUrl}/ota/OTA_HotelResModifyNotif`;
  const xmlBody = buildResNotifAcknowledge(reservationIds);

  try {
    const response = await withRateLimit('/ota/OTA_HotelResModifyNotif', async () => {
      return authenticatedFetch(connectionId, endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml', 'Accept': 'application/xml' },
        body: xmlBody,
      });
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get reservation summary for recovery after outage
 */
export async function getReservationSummary(connectionId: string): Promise<string> {
  const env = getEnvironmentForConn(connectionId);
  const hotelCode = getPropertyIdForConn(connectionId);
  const baseUrl = BOOKING_COM_URLS[env].secureSupply;
  const endpoint = `${baseUrl}/xml/reservationssummary`;

  const xmlBody = buildReservationSummaryRequest(hotelCode);

  const response = await withRateLimit('/xml/reservationssummary', async () => {
    return authenticatedFetch(connectionId, endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml', 'Accept': 'application/xml' },
      body: xmlBody,
    });
  });

  return response.text();
}

// ─── Process & Store Reservation in PMS ──────────────────────

/**
 * Save an OTA reservation into the PMS database.
 * Handles deduplication via external_uid / bcom_reservation_id.
 * Auto-creates guest if needed.
 */
export function processReservation(
  connectionId: string,
  reservation: OTAReservation,
): { action: 'created' | 'updated' | 'cancelled' | 'skipped'; reservationId: string | null } {
  const db = getDb();

  // Deduplication — check if we already have this reservation
  const existing = db.prepare(`
    SELECT id, status FROM reservations
    WHERE bcom_reservation_id = ? OR external_uid = ?
  `).get(reservation.externalReservationId, reservation.externalReservationId) as any;

  if (reservation.status === 'cancelled') {
    if (existing) {
      db.prepare(`
        UPDATE reservations SET status = 'cancelled', updated_at = datetime('now')
        WHERE id = ?
      `).run(existing.id);
      // Enqueue availability sync (room is now free)
      enqueueAvailabilitySync(connectionId, reservation.checkIn, reservation.checkOut);
      return { action: 'cancelled', reservationId: existing.id };
    }
    return { action: 'skipped', reservationId: null };
  }

  // Find or create guest
  const guestId = findOrCreateGuest(db, reservation);

  // Find matching unit
  const unit = findMatchingUnit(db, connectionId, reservation);

  // Calculate nights
  const checkIn = new Date(reservation.checkIn);
  const checkOut = new Date(reservation.checkOut);
  const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));

  if (existing) {
    // Update existing reservation
    db.prepare(`
      UPDATE reservations SET
        guest_id = ?, unit_id = ?,
        check_in = ?, check_out = ?, nights = ?,
        adults = ?, children = ?,
        total_price = ?, status = 'confirmed',
        notes = ?, smoking_preference = ?,
        price_per_night_json = ?,
        promotions_applied = ?,
        rate_rewriting_info = ?,
        cancellation_policy = ?,
        meal_plan = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      guestId, unit?.id || null,
      reservation.checkIn, reservation.checkOut, nights,
      reservation.adults, reservation.children,
      reservation.totalPrice, reservation.specialRequests || null,
      reservation.smokingPreference,
      JSON.stringify(reservation.pricePerNight),
      JSON.stringify(reservation.promotions),
      reservation.rateRewriting,
      reservation.cancellationPolicy,
      reservation.mealPlan,
      existing.id,
    );
    return { action: 'updated', reservationId: existing.id };
  }

  // Create new reservation
  const resId = `bcom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const org = db.prepare('SELECT id FROM organizations LIMIT 1').get() as any;
  const prop = db.prepare('SELECT id FROM properties LIMIT 1').get() as any;

  db.prepare(`
    INSERT INTO reservations (
      id, property_id, unit_id, guest_id,
      check_in, check_out, nights, adults, children,
      status, payment_status, source, total_price,
      external_uid, bcom_reservation_id,
      notes, smoking_preference,
      price_per_night_json, promotions_applied,
      rate_rewriting_info, cancellation_policy, meal_plan
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    resId, prop?.id || null, unit?.id || null, guestId,
    reservation.checkIn, reservation.checkOut, nights,
    reservation.adults, reservation.children,
    'confirmed', 'unpaid', 'booking_com', reservation.totalPrice,
    reservation.externalReservationId, reservation.externalReservationId,
    reservation.specialRequests || null, reservation.smokingPreference,
    JSON.stringify(reservation.pricePerNight),
    JSON.stringify(reservation.promotions),
    reservation.rateRewriting,
    reservation.cancellationPolicy,
    reservation.mealPlan,
  );

  // Enqueue availability sync (room is now occupied)
  enqueueAvailabilitySync(connectionId, reservation.checkIn, reservation.checkOut);

  return { action: 'created', reservationId: resId };
}

// ─── Helpers ─────────────────────────────────────────────────

function getEnvironmentForConn(connectionId: string): EnvironmentType {
  const db = getDb();
  const row = db.prepare(`
    SELECT cred.environment FROM channel_connections cc
    JOIN channel_credentials cred ON cc.credentials_id = cred.id
    WHERE cc.id = ?
  `).get(connectionId) as any;
  return (row?.environment as EnvironmentType) || 'test';
}

function getPropertyIdForConn(connectionId: string): string {
  const db = getDb();
  const row = db.prepare('SELECT external_property_id FROM channel_connections WHERE id = ?').get(connectionId) as any;
  return row?.external_property_id || '';
}

function findOrCreateGuest(db: any, res: OTAReservation): string {
  // Try to find existing guest by email
  if (res.bookerEmail) {
    const guest = db.prepare('SELECT id FROM guests WHERE email = ?').get(res.bookerEmail) as any;
    if (guest) return guest.id;
  }

  // Create new guest
  const guestId = `g_bcom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const org = db.prepare('SELECT id FROM organizations LIMIT 1').get() as any;

  db.prepare(`
    INSERT INTO guests (id, organization_id, first_name, last_name, email, phone)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    guestId, org?.id || null,
    res.bookerFirstName, res.bookerLastName,
    res.bookerEmail || null, res.bookerPhone || null,
  );

  return guestId;
}

function findMatchingUnit(db: any, connectionId: string, res: OTAReservation): any {
  // Find unit type via room mapping
  const mapping = db.prepare(`
    SELECT unit_type_id FROM channel_room_mapping
    WHERE connection_id = ? AND external_room_type_id = ? AND is_active = 1
  `).get(connectionId, res.roomTypeCode) as any;

  if (!mapping) return null;

  // Find first available unit of this type for the dates
  const unit = db.prepare(`
    SELECT u.id FROM units u
    WHERE u.unit_type_id = ?
      AND u.id NOT IN (
        SELECT r.unit_id FROM reservations r
        WHERE r.unit_id IS NOT NULL
          AND r.status NOT IN ('cancelled', 'no_show')
          AND r.check_in < ? AND r.check_out > ?
      )
    ORDER BY u.sort_order, u.name
    LIMIT 1
  `).get(mapping.unit_type_id, res.checkOut, res.checkIn) as any;

  return unit || null;
}

function enqueueAvailabilitySync(connectionId: string, dateFrom: string, dateTo: string): void {
  try {
    enqueueForAllConnections({
      syncType: 'inventory',
      dateFrom,
      dateTo,
      priority: 1, // High priority — availability changed
    });
  } catch (e: any) {
    console.error('[Reservations] Failed to enqueue availability sync:', e.message);
  }
}
