/**
 * Booking.com Reservations Pull Client
 * 
 * Pulls reservations from Booking.com via OTA XML (every 20 seconds).
 * Handles: new bookings, modifications, cancellations.
 * Acknowledges each reservation after processing.
 */

import { getDb } from '@core/db';
import { authenticatedFetch } from '../auth';
import { withRateLimit } from '../rate-limiter';
import { logSyncRequest, extractRUID } from '../ruid-logger';
import { buildResNotifAcknowledge, buildReservationSummaryRequest } from '../xml/ota-builder';
import { parseResNotifResponse } from '../xml/ota-parser';
import { enqueueForAllConnections } from '../../data/sync-queue';
import { BOOKING_COM_URLS } from '../types';
import type { OTAReservation, EnvironmentType } from '../types';
import { requireOrganizationId, requirePropertyId } from '@core/auth/tenant-context';
import { getSql } from '@core/db/async';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Pull new reservations from Booking.com
 */
export async function pullNewReservations(connectionId: string): Promise<OTAReservation[]> {
  const env = await getEnvironmentForConn(connectionId);
  const baseUrl = BOOKING_COM_URLS[env].secureSupply;
  const endpoint = `${baseUrl}/ota/OTA_HotelResNotif`;

  const startTime = Date.now();
  let ruid: string | null = null;
  let responseStatus: number | undefined;
  let responseBody: string | undefined;

  try {
    const response = await withRateLimit('/ota/OTA_HotelResNotif', async () => {
      return await authenticatedFetch(connectionId, endpoint, {
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
    await logSyncRequest({
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

  const env = await getEnvironmentForConn(connectionId);
  const baseUrl = BOOKING_COM_URLS[env].secureSupply;
  const endpoint = `${baseUrl}/ota/OTA_HotelResNotif`;

  const xmlBody = buildResNotifAcknowledge(reservationIds);
  const startTime = Date.now();

  try {
    const response = await withRateLimit('/ota/OTA_HotelResNotif', async () => {
      return await authenticatedFetch(connectionId, endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml', 'Accept': 'application/xml' },
        body: xmlBody,
      });
    });

    const responseBody = await response.text();
    const ruid = extractRUID(response.headers);

    await logSyncRequest({
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
  const env = await getEnvironmentForConn(connectionId);
  const baseUrl = BOOKING_COM_URLS[env].secureSupply;
  const endpoint = `${baseUrl}/ota/OTA_HotelResModifyNotif`;

  const startTime = Date.now();

  try {
    const response = await withRateLimit('/ota/OTA_HotelResModifyNotif', async () => {
      return await authenticatedFetch(connectionId, endpoint, {
        method: 'GET',
        headers: { 'Accept': 'application/xml' },
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
    });

    const responseBody = await response.text();
    const ruid = extractRUID(response.headers);

    await logSyncRequest({
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

  const env = await getEnvironmentForConn(connectionId);
  const baseUrl = BOOKING_COM_URLS[env].secureSupply;
  const endpoint = `${baseUrl}/ota/OTA_HotelResModifyNotif`;
  const xmlBody = buildResNotifAcknowledge(reservationIds);

  try {
    const response = await withRateLimit('/ota/OTA_HotelResModifyNotif', async () => {
      return await authenticatedFetch(connectionId, endpoint, {
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
  const env = await getEnvironmentForConn(connectionId);
  const hotelCode = await getPropertyIdForConn(connectionId);
  const baseUrl = BOOKING_COM_URLS[env].secureSupply;
  const endpoint = `${baseUrl}/xml/reservationssummary`;

  const xmlBody = buildReservationSummaryRequest(hotelCode);

  const response = await withRateLimit('/xml/reservationssummary', async () => {
    return await authenticatedFetch(connectionId, endpoint, {
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
export async function processReservation(
  connectionId: string,
  reservation: OTAReservation,
): Promise<{ action: 'created' | 'updated' | 'cancelled' | 'skipped'; reservationId: string | null }> {
  const sql = getSql();

  // Deduplication — check if we already have this reservation
  const existing = await sql.row<any>(`
    SELECT id, status FROM reservations
    WHERE bcom_reservation_id = ? OR external_uid = ?
  `, [reservation.externalReservationId, reservation.externalReservationId]) as any;

  if (reservation.status === 'cancelled') {
    if (existing) {
      await sql.run(`
        UPDATE reservations SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [existing.id]);
      // Enqueue availability sync (room is now free)
      enqueueAvailabilitySync(connectionId, reservation.checkIn, reservation.checkOut);
      return { action: 'cancelled', reservationId: existing.id };
    }
    return { action: 'skipped', reservationId: null };
  }

  // Find or create guest
  const guestId = await findOrCreateGuest(reservation);

  // Find matching unit
  const unit = await findMatchingUnit(connectionId, reservation);

  // Calculate nights
  const checkIn = new Date(reservation.checkIn);
  const checkOut = new Date(reservation.checkOut);
  const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));

  if (existing) {
    // Update existing reservation
    await sql.run(`
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
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [guestId, unit?.id || null,
      reservation.checkIn, reservation.checkOut, nights,
      reservation.adults, reservation.children,
      reservation.totalPrice, reservation.specialRequests || null,
      reservation.smokingPreference,
      JSON.stringify(reservation.pricePerNight),
      JSON.stringify(reservation.promotions),
      reservation.rateRewriting,
      reservation.cancellationPolicy,
      reservation.mealPlan,
      existing.id]);
    return { action: 'updated', reservationId: existing.id };
  }

  // Create new reservation
  const resId = `bcom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const org = { id: await requireOrganizationId() } as any;
  // The channel sync runs without a session; the organization comes from the
  // connection being synced, and the property from that organization. Taking
  // the first row filed an incoming Booking.com reservation against whichever
  // hotel the server created first.
  const prop = { id: await requirePropertyId() } as any;

  await sql.run(`
    -- organization_id, named rather than left to the column DEFAULT: that
    -- DEFAULT reads app.organization_id and exists only on Postgres (migration
    -- 0005). On SQLite the row landed with a NULL tenant. Taken from the
    -- property so it cannot disagree with it.
    INSERT INTO reservations (
      id, organization_id, property_id, unit_id, guest_id,
      check_in, check_out, nights, adults, children,
      status, payment_status, source, total_price,
      external_uid, bcom_reservation_id,
      notes, smoking_preference,
      price_per_night_json, promotions_applied,
      rate_rewriting_info, cancellation_policy, meal_plan
    ) VALUES (?, (SELECT organization_id FROM properties WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [resId, prop?.id || null, prop?.id || null, unit?.id || null, guestId,
    reservation.checkIn, reservation.checkOut, nights,
    reservation.adults, reservation.children,
    'confirmed', 'unpaid', 'booking_com', reservation.totalPrice,
    reservation.externalReservationId, reservation.externalReservationId,
    reservation.specialRequests || null, reservation.smokingPreference,
    JSON.stringify(reservation.pricePerNight),
    JSON.stringify(reservation.promotions),
    reservation.rateRewriting,
    reservation.cancellationPolicy,
    reservation.mealPlan]);

  // Enqueue availability sync (room is now occupied)
  enqueueAvailabilitySync(connectionId, reservation.checkIn, reservation.checkOut);

  return { action: 'created', reservationId: resId };
}

// ─── Helpers ─────────────────────────────────────────────────

async function getEnvironmentForConn(connectionId: string): Promise<EnvironmentType> {
  const sql = getSql();
  const row = await sql.row<any>(`
    SELECT cred.environment FROM channel_connections cc
    JOIN channel_credentials cred ON cc.credentials_id = cred.id
    WHERE cc.id = ?
  `, [connectionId]) as any;
  return (row?.environment as EnvironmentType) || 'test';
}

async function getPropertyIdForConn(connectionId: string): Promise<string> {
  const sql = getSql();
  const row = await sql.row<any>('SELECT external_property_id FROM channel_connections WHERE id = ?', [connectionId]) as any;
  return row?.external_property_id || '';
}

async function findOrCreateGuest(res: OTAReservation): Promise<string> {
  const sql = getSql();
  // Try to find existing guest by email
  if (res.bookerEmail) {
    const guest = await sql.row<any>('SELECT id FROM guests WHERE email = ?', [res.bookerEmail]) as any;
    if (guest) return guest.id;
  }

  // Create new guest
  const guestId = `g_bcom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const org = { id: await requireOrganizationId() } as any;

  await sql.run(`
    INSERT INTO guests (id, organization_id, first_name, last_name, email, phone)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [guestId, org?.id || null,
    res.bookerFirstName, res.bookerLastName,
    res.bookerEmail || null, res.bookerPhone || null]);

  return guestId;
}

async function findMatchingUnit(connectionId: string, res: OTAReservation): Promise<any> {
  const sql = getSql();
  // Find unit type via room mapping
  const mapping = await sql.row<any>(`
    SELECT unit_type_id FROM channel_room_mapping
    WHERE connection_id = ? AND external_room_type_id = ? AND is_active = TRUE
  `, [connectionId, res.roomTypeCode]) as any;

  if (!mapping) return null;

  // Find first available unit of this type for the dates
  const unit = await sql.row<any>(`
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
  `, [mapping.unit_type_id, res.checkOut, res.checkIn]) as any;

  return unit || null;
}

async function enqueueAvailabilitySync(connectionId: string, dateFrom: string, dateTo: string): Promise<void> {
  try {
    await enqueueForAllConnections({
      syncType: 'inventory',
      dateFrom,
      dateTo,
      priority: 1, // High priority — availability changed
    });
  } catch (e: any) {
    console.error('[Reservations] Failed to enqueue availability sync:', e.message);
  }
}
