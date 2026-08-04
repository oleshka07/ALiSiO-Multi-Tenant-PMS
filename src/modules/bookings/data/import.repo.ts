/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb, generateGuestToken } from '@core/db';
import { findOrCreateGuest } from '@guests';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { getSql } from '@core/db/async';

export interface UnitTypeMatch {
  id: string;
  name: string;
  code: string;
}

export interface FreeUnit {
  id: string;
  name: string;
  code: string;
  unit_type_id: string;
  building_code: string | null;   // 'F', 'D', etc — used for "fell back to other building" warnings
}

export interface ExistingReservation {
  id: string;
  status: string;
  unit_id: string | null;
}

/** Resolve the resort property id (first property whose units belong to a resort category). */
export async function findResortPropertyId(): Promise<string | null> {
  const sql = getSql();
  const row = await sql.row<any>(`
    SELECT u.property_id as id
    FROM units u
    JOIN categories c ON c.id = u.category_id
    WHERE c.type = 'resort'
    LIMIT 1
  `) as any;
  return row?.id || null;
}

/**
 * Match a Booking.com unit-type name (e.g. "Triple Room") to a local unit_type.
 * Strategy: case-insensitive contains on unit_types.name.
 * Returns null if no match — caller should warn the user.
 */
export async function findUnitTypeByName(name: string): Promise<UnitTypeMatch | null> {
  if (!name) return null;
  const sql = getSql();
  const lower = name.toLowerCase().trim();

  const exact = await sql.row<any>(`
    SELECT ut.id, ut.name, ut.code
    FROM unit_types ut
    JOIN categories c ON c.id = ut.category_id
    WHERE c.type = 'resort' AND LOWER(ut.name) = ?
    LIMIT 1
  `, [lower]) as any;
  if (exact) return exact;

  const fuzzy = await sql.row<any>(`
    SELECT ut.id, ut.name, ut.code
    FROM unit_types ut
    JOIN categories c ON c.id = ut.category_id
    WHERE c.type = 'resort' AND LOWER(ut.name) LIKE ?
    LIMIT 1
  `, [`%${lower}%`]) as any;
  return fuzzy || null;
}

// Building priority: F is the primary resort building, fall back to others
// (D — Wellness Hostel, etc) only when F is fully booked. The CASE turns
// "is it F?" into a 0/1 sort key that we put first in ORDER BY.
const PREFER_F_ORDER = "CASE WHEN b.code = 'F' THEN 0 ELSE 1 END ASC";

/** Find any free resort unit of the given type for the given dates. */
export async function findFreeResortUnit(
  unitTypeId: string,
  checkIn: string,
  checkOut: string,
): Promise<FreeUnit | null> {
  const sql = getSql();
  const row = await sql.row<any>(`
    SELECT u.id, u.name, u.code, u.unit_type_id, b.code AS building_code
    FROM units u
    JOIN categories c ON c.id = u.category_id
    LEFT JOIN buildings b ON b.id = u.building_id
    WHERE c.type = 'resort'
      AND u.unit_type_id = ?
      AND u.is_active = 1
      AND u.id NOT IN (
        SELECT unit_id FROM reservations
        WHERE status NOT IN ('cancelled', 'no_show')
          AND check_in < ? AND check_out > ?
      )
    ORDER BY ${PREFER_F_ORDER}, u.sort_order ASC, u.name ASC
    LIMIT 1
  `, [unitTypeId, checkOut, checkIn]) as any;
  return row || null;
}

/**
 * Capacity-based match: find the first free resort unit whose unit_type can
 * accommodate at least the requested number of guests. Used when the Excel
 * row carries a Booking.com unit-type name (e.g. "Triple Room") that doesn't
 * exactly match a local unit_type record.
 *
 * Strategy:
 *   1. Exact match on max_occupancy (or max_adults when max_occupancy is NULL).
 *   2. Round-up: smallest unit_type with max_occupancy >= capacity.
 *      A guest who booked a Triple Room (3) can stay in a Quadruple (4).
 *      They cannot stay in a Double (2) — that would be overbooked.
 *
 * Excludes the optional `excludeUnitIds` set so a multi-room booking does
 * not pick the same unit twice for two rooms in the same group.
 */
export async function findFreeResortUnitByCapacity(
  capacity: number,
  checkIn: string,
  checkOut: string,
  excludeUnitIds: string[] = [],
): Promise<FreeUnit | null> {
  const sql = getSql();
  const excludeClause = excludeUnitIds.length > 0
    ? `AND u.id NOT IN (${excludeUnitIds.map(() => '?').join(',')})`
    : '';

  // Capacity per unit: prefer units.beds (this is what the UI labels show —
  // "F1 · 2 місць" = beds=2), then fall back to unit_types fields. base_
  // occupancy and max_occupancy are often NULL in practice, so the legacy
  // chain alone returns nothing. units.beds is filled in for every active
  // unit, so it works as a robust primary key for capacity.
  const occExpr = 'COALESCE(u.beds, ut.base_occupancy, ut.max_occupancy, ut.max_adults, 0)';

  // Pass 1 — exact match. Building F preferred over any other building.
  const exact = await sql.row<any>(`
    SELECT u.id, u.name, u.code, u.unit_type_id, b.code AS building_code
    FROM units u
    JOIN categories c ON c.id = u.category_id
    JOIN unit_types ut ON ut.id = u.unit_type_id
    LEFT JOIN buildings b ON b.id = u.building_id
    WHERE c.type = 'resort'
      AND u.is_active = 1
      AND ${occExpr} = ?
      AND u.id NOT IN (
        SELECT unit_id FROM reservations
        WHERE status NOT IN ('cancelled', 'no_show')
          AND check_in < ? AND check_out > ?
      )
      ${excludeClause}
    ORDER BY ${PREFER_F_ORDER}, u.sort_order ASC, u.name ASC
    LIMIT 1
  `, [capacity, checkOut, checkIn, ...excludeUnitIds]) as any;
  if (exact) return exact;

  // Pass 2 — round up to the smallest unit type that fits, still preferring F.
  const roundUp = await sql.row<any>(`
    SELECT u.id, u.name, u.code, u.unit_type_id, b.code AS building_code
    FROM units u
    JOIN categories c ON c.id = u.category_id
    JOIN unit_types ut ON ut.id = u.unit_type_id
    LEFT JOIN buildings b ON b.id = u.building_id
    WHERE c.type = 'resort'
      AND u.is_active = 1
      AND ${occExpr} >= ?
      AND u.id NOT IN (
        SELECT unit_id FROM reservations
        WHERE status NOT IN ('cancelled', 'no_show')
          AND check_in < ? AND check_out > ?
      )
      ${excludeClause}
    ORDER BY ${PREFER_F_ORDER}, ${occExpr} ASC, u.sort_order ASC, u.name ASC
    LIMIT 1
  `, [capacity, checkOut, checkIn, ...excludeUnitIds]) as any;
  return roundUp || null;
}

/** Find the pool (staging) unit for Building F. */
export async function findPoolUnit(): Promise<FreeUnit | null> {
  const sql = getSql();
  const row = await sql.row<any>(`
    SELECT u.id, u.name, u.code, u.unit_type_id, b.code AS building_code
    FROM units u
    LEFT JOIN buildings b ON b.id = u.building_id
    WHERE u.is_pool = 1
    ORDER BY u.name ASC
    LIMIT 1
  `) as any;
  return row || null;
}

/** Find a reservation already imported with this Booking.com book number. */
export async function findReservationByBcomId(bookNumber: string): Promise<ExistingReservation | null> {
  const sql = getSql();
  const row = await sql.row<any>(`
    SELECT id, status, unit_id FROM reservations
    WHERE bcom_reservation_id = ? OR external_uid = ?
    LIMIT 1
  `, [bookNumber, bookNumber]) as any;
  return row || null;
}

/** Mark an existing reservation as cancelled (for cancelled_by_guest rows). */
export async function cancelReservation(reservationId: string): Promise<void> {
  const sql = getSql();
  await sql.run(`
    UPDATE reservations
    SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [reservationId]);
}

/**
 * Thin wrapper over the unified @guests/findOrCreateGuest helper.
 * Booking.com exports rarely include email, so this flow has no email key —
 * the helper falls back to phone, then to first+last name. Address/country
 * are filled in if missing on an existing row.
 */
export async function findOrCreateGuestForImport(args: {
  firstName: string;
  lastName: string;
  country: string | null;
  phone: string | null;
  address: string | null;
}): Promise<string> {
  const sql = getSql();
  const org = { id: requireOrganizationId(getDb()) } as any;
  return (await findOrCreateGuest({
    organizationId: org?.id,
    firstName: args.firstName,
    lastName: args.lastName,
    phone: args.phone,
    address: args.address,
    country: args.country,
  })).id;
}

export interface InsertReservationArgs {
  propertyId: string;
  unitId: string | null;
  guestId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  status?: 'confirmed' | 'draft';
  totalPrice: number;            // Amount in `currency`
  currency: string;              // Stored currency tag — usually 'CZK' even for EUR-source bookings
  bcomReservationId: string;
  commissionAmount: number;      // In `currency`
  notes: string;
  // Native EUR fields preserved alongside the CZK totals (mirrors Hostex sync).
  // Set when the original Booking.com row was priced in EUR.
  totalRateEur?: number | null;
  commissionEur?: number | null;
}

export async function insertImportedReservation(args: InsertReservationArgs): Promise<string> {
  const sql = getSql();
  const resId = `bcom_xls_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const guestPageToken = generateGuestToken();

  await sql.run(`
    INSERT INTO reservations (
      id, property_id, unit_id, guest_id,
      check_in, check_out, nights, adults, children,
      status, payment_status, source, total_price, currency,
      external_uid, bcom_reservation_id,
      commission_amount, notes, guest_page_token,
      total_rate_eur, commission_eur
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', 'booking_com', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [resId, args.propertyId, args.unitId, args.guestId,
    args.checkIn, args.checkOut, args.nights, args.adults, args.children,
    args.status || 'confirmed',
    args.totalPrice, args.currency,
    args.bcomReservationId, args.bcomReservationId,
    args.commissionAmount, args.notes, guestPageToken,
    args.totalRateEur ?? null, args.commissionEur ?? null]);

  return resId;
}
