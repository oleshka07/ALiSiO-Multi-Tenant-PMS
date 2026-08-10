/**
 * Hostex → ALiSiO ERP Sync Service
 * Handles reservation, guest, and payment synchronization
 */
import { getDb, generateGuestToken } from '@core/db';
import { appBaseUrl } from '@core/app-url';
import {
  getProperties,
  getAllReservations,
  updateReservationRemarks,
  updateReservationCustomField,
  type HostexReservation,
} from '../domain/hostex-client';
import { getEurCzkRate } from '@/modules/finance/domain/cnb-rates';
import { notifyReservationCreated } from '@/modules/bookings/domain/reservation-tg-notify';
import { findOrCreateGuest as findOrCreateGuestUnified } from '@guests';
import { money } from '@core/money';
import { getSql } from '@core/db/async';

// Public URL of the PMS (used to build guest page links sent to Hostex)
const PMS_BASE_URL = appBaseUrl();

// Channel types that represent owner blocks / closed dates — NOT real guests
const BLOCKED_CHANNEL_TYPES = new Set(['owner', 'manual', 'owner_reservation', 'blocked', 'maintenance']);

// ─── Property Mapping ─────────────────────────────────────

/**
 * Which unit a Hostex property belongs to — and, through it, which hotel.
 *
 * This was a literal table of six ids from the first customer, next to a
 * hardcoded PROPERTY_ID and ORG_ID. Those two ids exist in no other database,
 * so the cron failed with a foreign key error on every other install; and had
 * they existed, one hotel's Hostex bookings would have been written into
 * another hotel's account. hostex_property_map is the mapping the settings
 * screen already writes — it just was not read.
 */
interface MappedUnit {
  unitId: string;
  propertyId: string;
  organizationId: string;
}

async function mapHostexProperty(hostexPropertyId: number): Promise<MappedUnit | null> {
  const sql = getSql();
  const row = await sql.row<any>(`
    SELECT m.unit_id, u.property_id, p.organization_id
    FROM hostex_property_map m
    JOIN units u ON m.unit_id = u.id
    JOIN properties p ON u.property_id = p.id
    WHERE m.hostex_property_id = ?
  `, [hostexPropertyId]) as
    { unit_id: string; property_id: string; organization_id: string } | undefined;
  if (!row) return null;
  return { unitId: row.unit_id, propertyId: row.property_id, organizationId: row.organization_id };
}

// ─── Channel type → source mapping ───────────────────────
function mapChannelToSource(channelType: string): string {
  switch (channelType) {
    case 'airbnb':       return 'airbnb';
    case 'booking.com':  return 'booking_com';
    case 'booking_site': return 'direct';
    case 'agoda':        return 'other_ota';
    default:             return 'other_ota';
  }
}

// ─── Payment detection from channel_remarks ───────────────
interface PaymentInfo {
  isPrepaid: boolean;
  paymentCharge: number | null;
  channelType: string;
}

function detectPaymentInfo(reservation: HostexReservation): PaymentInfo {
  const remarks = (reservation.channel_remarks || '').toLowerCase();
  const channelType = reservation.channel_type;

  // Airbnb always collects payment upfront
  if (channelType === 'airbnb') {
    return { isPrepaid: true, paymentCharge: null, channelType };
  }

  if (channelType === 'booking.com') {
    const isPrepaid =
      remarks.includes('pre-paid') ||
      remarks.includes('prepaid') ||
      remarks.includes('virtual credit card') || // VCC = guaranteed payment
      remarks.includes('virtual card') ||
      remarks.includes('credit card:') ||        // CC details present = collectible
      remarks.includes('mastercard') ||
      remarks.includes('visa');
    let paymentCharge: number | null = null;
    const chargeMatch = remarks.match(/payment charge is (\w+)\s+([\d.]+)/i);
    if (chargeMatch) paymentCharge = parseFloat(chargeMatch[2]);
    return { isPrepaid, paymentCharge, channelType };
  }

  // booking_site (direct) — usually paid on arrival unless stated
  if (channelType === 'booking_site' || channelType === 'hostex_direct') {
    return { isPrepaid: false, paymentCharge: null, channelType };
  }

  return { isPrepaid: false, paymentCharge: null, channelType };
}

// ─── Guest name splitting ─────────────────────────────────
function splitGuestName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// ─── Date normalization ───────────────────────────────────
// Hostex sometimes sends datetime strings like "2026-04-20T22:00:00Z" (UTC midnight Czech time)
// We always normalize to plain YYYY-MM-DD in Czech timezone
function normalizeHostexDate(dateStr: string): string {
  if (!dateStr) return dateStr;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
    }
  } catch { /* ignore */ }
  return dateStr.substring(0, 10);
}

// ─── Calculate nights ─────────────────────────────────────
function calcNights(checkIn: string, checkOut: string): number {
  const d1 = new Date(normalizeHostexDate(checkIn) + 'T12:00:00');
  const d2 = new Date(normalizeHostexDate(checkOut) + 'T12:00:00');
  return Math.max(1, Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)));
}

// ─── Main sync function ──────────────────────────────────

export interface SyncResult {
  synced: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  eurCzkRate: number;
}

export async function syncReservations(): Promise<SyncResult> {
  const sql = getSql();
  const result: SyncResult = {
    synced: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    eurCzkRate: 25.2,
  };

  try {
    // 1. Get EUR→CZK rate
    result.eurCzkRate = await getEurCzkRate();
    console.log(`[Hostex Sync] EUR/CZK rate: ${result.eurCzkRate}`);

    // 2. Fetch all non-cancelled reservations from Hostex
    const reservations = await getAllReservations();
    console.log(`[Hostex Sync] Fetched ${reservations.length} reservations from Hostex`);

    // 3. Ensure DB tables/columns exist + run migrations
    ensureHostexColumns();

    // 4. Process each reservation
    for (const res of reservations) {
      try {
        await processReservation(res, result);
      } catch (e: any) {
        result.errors.push(`${res.reservation_code}: ${e.message}`);
        console.error(`[Hostex Sync] Error processing ${res.reservation_code}:`, e.message);
      }
    }

    // 5. Log result
    logSync('reservations', result.errors.length === 0 ? 'success' : 'partial',
      result.synced, result.errors.join('; '));

    console.log(`[Hostex Sync] Done: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors.length} errors`);

  } catch (e: any) {
    result.errors.push(`Sync failed: ${e.message}`);
    console.error('[Hostex Sync] Fatal error:', e.message);
    await logSync('reservations', 'error', 0, e.message);
  }

  return result;
}

/**
 * Sync a single reservation by its code — used by webhook handler.
 * Uses ?reservation_code= filter which BYPASSES the 20-record global cap.
 * Much faster than a full sync for real-time webhook processing.
 */
export async function syncSingleReservation(reservationCode: string): Promise<SyncResult> {
  const sql = getSql();
  const result: SyncResult = { synced: 0, created: 0, updated: 0, skipped: 0, errors: [], eurCzkRate: 25.2 };

  try {
    const { getReservationByCode } = await import('../domain/hostex-client');
    const { getEurCzkRate: fetchRate } = await import('@/modules/finance/domain/cnb-rates');
    result.eurCzkRate = await fetchRate();
    ensureHostexColumns();

    const reservation = await getReservationByCode(reservationCode);
    if (!reservation) {
      result.errors.push(`Reservation ${reservationCode} not found in Hostex API`);
      console.warn(`[Hostex Sync] Reservation ${reservationCode} not found`);
      return result;
    }

    await processReservation(reservation, result);
    logSync('webhook', result.errors.length === 0 ? 'success' : 'partial', result.synced, result.errors.join('; '));
    console.log(`[Hostex Sync] Webhook sync done for ${reservationCode}: created=${result.created} updated=${result.updated}`);
  } catch (e: any) {
    result.errors.push(e.message);
    console.error('[Hostex Sync] syncSingleReservation error:', e.message);
  }

  return result;
}

// ─── Process single reservation ───────────────────────────

async function processReservation(res: HostexReservation, result: SyncResult) {
  const sql = getSql();
  // Blocked dates (owner/manual closures) → availability_blocks, NOT reservations
  if (BLOCKED_CHANNEL_TYPES.has(res.channel_type)) {
    processBlockedDate(res, result);
    return;
  }

  // Cancelled → mark in DB or skip
  if (res.status === 'cancelled' || res.status === 'denied' || res.status === 'timeout') {
    const existing = await sql.row<any>('SELECT id FROM reservations WHERE hostex_reservation_code = ?', [res.reservation_code]) as any;
    if (existing) {
      await sql.run("UPDATE reservations SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [existing.id]);
      result.updated++;
      result.synced++;
    } else {
      result.skipped++;
    }
    return;
  }

  // Map property → unit → hotel
  const mapped = await mapHostexProperty(res.property_id);
  const unitId = mapped?.unitId;
  if (!mapped || !unitId) {
    console.warn(`[Hostex] UNMAPPED property_id=${res.property_id} guest="${res.guest_name}" stay_code="${res.stay_code}" channel="${res.channel_type}" listing="${res.listing_id}" check_in=${res.check_in_date}`);
    result.skipped++;
    return;
  }

  // Calculate financial data
  const totalEur = res.rates?.total_rate?.amount || 0;
  const commissionEur = res.rates?.total_commission?.amount || 0;
  const netEur = totalEur - commissionEur;
  const totalCzk = money(totalEur * result.eurCzkRate);

  // Multi-room detection (Booking.com group bookings carry an _N- marker)
  const multiRoomMarker = detectMultiRoomMarker(res.stay_code);
  const isMultiRoom = multiRoomMarker ? 1 : 0;

  // Payment info, notes, status
  const paymentInfo = detectPaymentInfo(res);
  const financialNote = buildFinancialNote(res, result.eurCzkRate, totalEur, commissionEur, netEur, totalCzk);
  const status = mapStatus(res);
  const paymentStatus = paymentInfo.isPrepaid ? 'paid' : 'unpaid';

  // Find or create guest
  const guestId = await findOrCreateGuest(res, mapped.organizationId);

  // Check if already in DB
  const existing = await sql.row<any>('SELECT id, status, payment_status, guest_page_token FROM reservations WHERE hostex_reservation_code = ?', [res.reservation_code]) as any;

  const checkIn = normalizeHostexDate(res.check_in_date);
  const checkOut = normalizeHostexDate(res.check_out_date);
  const nights = calcNights(res.check_in_date, res.check_out_date);

  if (existing) {
    // Generate token if missing (backfill old bookings)
    const existingToken = existing.guest_page_token;
    const newToken = (!existingToken && (status === 'confirmed' || status === 'checked_in'))
      ? generateGuestToken() : null;
    const tokenClause = newToken ? ', guest_page_token = ?' : '';

    // Status priority: don't let sync downgrade a status that was set locally in PMS
    // e.g. if PMS has checked_in but Hostex still says confirmed → keep checked_in
    const STATUS_PRIORITY: Record<string, number> = {
      tentative: 1, confirmed: 2, checked_in: 3, checked_out: 4, cancelled: 5, no_show: 5,
    };
    const existingStatus = existing.status as string;
    const existingPriority = STATUS_PRIORITY[existingStatus] || 0;
    const incomingPriority = STATUS_PRIORITY[status] || 0;
    const finalStatus = incomingPriority >= existingPriority ? status : existingStatus;

    const params: any[] = [
      checkIn, checkOut, nights,
      res.number_of_adults, res.number_of_children, res.number_of_infants,
      finalStatus, existing.payment_status === 'paid' ? 'paid' : paymentStatus,
      totalCzk, mapChannelToSource(res.channel_type),
      res.channel_type, res.channel_id, res.listing_id,
      totalEur, commissionEur, netEur,
      res.channel_remarks, paymentInfo.isPrepaid ? 1 : 0,
      financialNote,
      isMultiRoom, multiRoomMarker,
    ];
    if (newToken) params.push(newToken);
    params.push(existing.id);

    await sql.run(`
      UPDATE reservations SET
        check_in = ?, check_out = ?, nights = ?,
        adults = ?, children = ?, infants = ?,
        status = ?, payment_status = ?,
        total_price = ?, source = ?,
        hostex_channel_type = ?, hostex_channel_id = ?, hostex_listing_id = ?,
        total_rate_eur = ?, commission_eur = ?, net_rate_eur = ?,
        channel_remarks = ?, is_prepaid = ?,
        notes = ?,
        is_multi_room = ?, multi_room_marker = ?${tokenClause},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [...params]);

    // Channel-mediated «sigals» (Hostex prepaid → fin_operation) removed.
    // Reservation.payment_status='paid' is set independently above from
    // Hostex's own is_prepaid flag — that's what PMS check-in reads.
    // Real money lands in fin_operations only when the bank statement
    // arrives (KB IMAP / manual import) and finance can attribute it to
    // a reservation via the Booking/Airbnb statement upload flow.
    // Legacy hostex-sourced ops created before this change stay in the
    // DB and will be cleaned up by a follow-up migration.

    // PR #15: upsert clearing receivable for channel-sourced bookings
    try {
      const isEurChannel = ['airbnb', 'vrbo'].includes(mapChannelToSource(res.channel_type));
      const recvCurrency = isEurChannel || (totalEur && totalEur > 0) ? 'EUR' : 'CZK';
      const recvAmount = recvCurrency === 'EUR' && totalEur ? totalEur : totalCzk;
    } catch (e: any) { console.log('[Hostex] receivable upsert error:', e.message); }

    // Push guest page URL to Hostex as custom field → use {{cf.guest_page_url}} in message templates
    const activeToken = newToken || existingToken;
    if (activeToken) {
      const guestPageUrl = `${PMS_BASE_URL}/guest/${activeToken}`;
      // Only update if URL changed (avoid unnecessary API calls)
      const currentUrl = (res.custom_fields as any)?.guest_page_url || '';
      if (currentUrl !== guestPageUrl) {
        await updateReservationCustomField(res.stay_code, { guest_page_url: guestPageUrl }).catch(() => {});
      }
    }

    result.updated++;

  } else {
    // Create new reservation
    const newId = `hx_${res.reservation_code.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40)}`;
    const guestPageToken = (status === 'confirmed' || status === 'checked_in') ? generateGuestToken() : null;

    await sql.run(`
      INSERT INTO reservations (
        id, property_id, unit_id, guest_id, check_in, check_out, nights,
        adults, children, infants, status, payment_status, source,
        total_price, currency, notes, guest_page_token,
        hostex_reservation_code, hostex_stay_code, hostex_channel_type,
        hostex_channel_id, hostex_listing_id,
        total_rate_eur, commission_eur, net_rate_eur,
        channel_remarks, is_prepaid,
        is_multi_room, multi_room_marker
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, 'CZK', ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?
      )
    `, [newId, mapped.propertyId, unitId, guestId,
      checkIn, checkOut, nights,
      res.number_of_adults, res.number_of_children, res.number_of_infants,
      status, paymentStatus, mapChannelToSource(res.channel_type),
      totalCzk, financialNote, guestPageToken,
      res.reservation_code, res.stay_code, res.channel_type,
      res.channel_id, res.listing_id,
      totalEur, commissionEur, netEur,
      res.channel_remarks, paymentInfo.isPrepaid ? 1 : 0,
      isMultiRoom, multiRoomMarker]);

    // No auto-payment fin_operation creation — see comment in the «existing
    // reservation» branch above. Hostex prepaid flag drives reservation
    // payment_status; real money is recorded only on bank settlement.

    // PR #15: upsert clearing receivable for channel-sourced bookings
    try {
      const isEurChannel = ['airbnb', 'vrbo'].includes(mapChannelToSource(res.channel_type));
      const recvCurrency = isEurChannel || (totalEur && totalEur > 0) ? 'EUR' : 'CZK';
      const recvAmount = recvCurrency === 'EUR' && totalEur ? totalEur : totalCzk;
    } catch (e: any) { console.log('[Hostex] receivable upsert error:', e.message); }

    if (guestPageToken) {
      const guestPageUrl = `${PMS_BASE_URL}/guest/${guestPageToken}`;
      // Write to Hostex custom field — use {{cf.guest_page_url}} in Hostex message templates
      await updateReservationCustomField(res.stay_code, { guest_page_url: guestPageUrl }).catch(() => {});
    }

    notifyReservationCreated(newId, {
      sourceLabel: `Hostex · ${res.channel_type || 'channel'}`,
      emoji: '🔄',
    });

    result.created++;
  }

  result.synced++;
}


// ─── Process blocked date (owner closure in Hostex) ────────

async function processBlockedDate(res: HostexReservation, result: SyncResult) {
  const sql = getSql();
  const unitId = (await mapHostexProperty(res.property_id))?.unitId;
  if (!unitId) { result.skipped++; return; }

  const blockId = `hx_block_${res.reservation_code.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40)}`;
  const existingBlock = await sql.row<any>('SELECT id FROM availability_blocks WHERE id = ?', [blockId]);

  if (res.status === 'cancelled') {
    if (existingBlock) {
      await sql.run('DELETE FROM availability_blocks WHERE id = ?', [blockId]);
      result.updated++;
      result.synced++;
    } else {
      result.skipped++;
    }
    return;
  }

  const notes = res.remarks || res.channel_remarks || 'Закрито в Hostex';
  const dateFrom = normalizeHostexDate(res.check_in_date);
  const dateTo = normalizeHostexDate(res.check_out_date);

  if (existingBlock) {
    await sql.run('UPDATE availability_blocks SET date_from = ?, date_to = ?, notes = ? WHERE id = ?', [dateFrom, dateTo, notes, blockId]);
    result.updated++;
  } else {
    await sql.run(`
      INSERT INTO availability_blocks (id, unit_id, date_from, date_to, reason, notes, hostex_code)
      VALUES (?, ?, ?, ?, 'blocked', ?, ?)
    `, [blockId, unitId, dateFrom, dateTo, notes, res.reservation_code]);
    result.created++;
  }

  result.synced++;
}

// ─── Guest management ─────────────────────────────────────

async function findOrCreateGuest(res: HostexReservation, organizationId: string): Promise<string> {
  const guestData = res.guests?.[0];
  const rawEmail = guestData?.email || res.guest_email || '';
  // Booking's privacy-proxy emails (@guest.booking.com) are not stable identifiers
  // — strip them so the unified helper falls through to phone/name dedup.
  const email = rawEmail && !rawEmail.includes('@guest.booking.com') ? rawEmail : null;
  const phone = guestData?.phone || res.guest_phone || null;
  const name = guestData?.name || res.guest_name || 'Unknown';
  const country = guestData?.country || null;

  const { firstName, lastName } = splitGuestName(name);
  return (await findOrCreateGuestUnified({
    organizationId,
    firstName,
    lastName,
    email,
    phone,
    country,
  })).id;
}

// ─── Status mapping ───────────────────────────────────────

function mapStatus(res: HostexReservation): string {
  if (res.stay_status === 'stay_completed') return 'checked_out';
  if (res.stay_status === 'stay_in_progress') return 'checked_in';
  if (res.status === 'accepted') return 'confirmed';
  if (res.status === 'wait_accept' || res.status === 'wait_pay') return 'tentative';
  if (res.status === 'cancelled' || res.status === 'denied') return 'cancelled';
  return 'confirmed';
}

// ─── Financial note builder ───────────────────────────────

function buildFinancialNote(
  res: HostexReservation,
  rate: number,
  totalEur: number,
  commissionEur: number,
  netEur: number,
  totalCzk: number
): string {
  const channel = res.custom_channel?.name || res.channel_type;
  const lines = [
    `📊 ${channel} | ${res.channel_id}`,
    `💶 Всього: €${totalEur.toFixed(2)} (${totalCzk} CZK @ ${rate.toFixed(2)})`,
  ];

  if (commissionEur > 0) {
    const commCzk = Math.round(commissionEur * rate);
    const netCzk = Math.round(netEur * rate);
    lines.push(`📉 Комісія: €${commissionEur.toFixed(2)} (${commCzk} CZK)`);
    lines.push(`💰 Нетто: €${netEur.toFixed(2)} (${netCzk} CZK)`);
  }

  const pricesMatch = res.channel_remarks?.match(/Prices:\s*(.+?)(?:\n|$)/);
  if (pricesMatch) lines.push(`🌙 ${pricesMatch[1].trim()}`);

  const cleaning = res.rates?.details?.find(d => d.type === 'CLEANING_FEE');
  if (cleaning) lines.push(`🧹 Прибирання: €${cleaning.amount.toFixed(2)}`);

  return lines.join('\n');
}

// ─── Multi-room detection ─────────────────────────────────
//
// Booking.com group bookings (one guest reserves multiple cabins under
// one confirmation) come through Hostex as a single reservation_code
// with an aggregated total_rate. The hostex_stay_code carries an
// "_N-" marker (e.g. "9-5169043266_3-ibzjrqm6ja") that identifies the
// booking as part of a multi-cabin group. We extract the marker so
// the operator can verify in Hostex which cabins are actually booked.

const MULTI_ROOM_RE = /(_[1-9]\d?-)/;

function detectMultiRoomMarker(stayCode: string | null | undefined): string | null {
  if (!stayCode) return null;
  const m = stayCode.match(MULTI_ROOM_RE);
  return m ? m[1] : null;
}

// ─── DB migrations for Hostex columns ─────────────────────

async function ensureHostexColumns() {
  const sql = getSql();
  // The Hostex columns on `reservations` are part of the schema itself — the
  // boot migration in core/db adds them whether or not this integration ever
  // runs, and payments.auto_created ships in that table's own CREATE. So is the
  // index on hostex_reservation_code, which used to be created here on every
  // sync: harmless on SQLite, impossible on Postgres, where CREATE INDEX
  // requires owning the table and the application's role owns nothing. It took
  // the sync down on the first run against Postgres.

  // hostex_sync_log, hostex_property_map and availability_blocks used to be
  // created here as well. The boot migration in core/db creates all three
  // before any request is served, so these were no-ops — and the two copies
  // had already drifted apart, which is the actual reason they are gone.

  // Migration 1: Backfill guest_page_token for existing Hostex bookings without token
  try {
    const missing = await sql.rows<any>(`
      SELECT id FROM reservations
      WHERE hostex_reservation_code IS NOT NULL
        AND (guest_page_token IS NULL OR guest_page_token = '')
        AND status IN ('confirmed', 'checked_in', 'tentative')
    `) as { id: string }[];
    if (missing.length > 0) {
      for (const r of missing) {
        await sql.run('UPDATE reservations SET guest_page_token = ? WHERE id = ?', [generateGuestToken(), r.id]);
      }
      console.log(`[Hostex] Backfilled guest_page_token for ${missing.length} bookings`);
    }
  } catch (e: any) {
    console.warn('[Hostex] guest_page_token backfill note:', e.message);
  }

  // Migration 2: Move blocked-channel reservations → availability_blocks
  try {
    const BLOCKED_TYPES = ['owner', 'manual', 'owner_reservation', 'blocked', 'maintenance'];
    const ph = BLOCKED_TYPES.map(() => '?').join(', ');
    const blockedRes = await sql.rows<any>(`
      SELECT id, unit_id, check_in, check_out, notes, channel_remarks, hostex_reservation_code
      FROM reservations
      WHERE hostex_reservation_code IS NOT NULL
        AND hostex_channel_type IN (${ph})
    `, [...BLOCKED_TYPES]) as any[];

    if (blockedRes.length > 0) {
      for (const r of blockedRes) {
        const blockId = `hx_block_${(r.hostex_reservation_code || r.id).replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40)}`;
        // Both statements together: a reservation must not disappear unless
        // the block that replaces it exists.
        await sql.tx(async (t) => {
          await t.run(`
            INSERT INTO availability_blocks (id, unit_id, date_from, date_to, reason, notes, hostex_code)
            VALUES (?, ?, ?, ?, 'blocked', ?, ?)
            ON CONFLICT DO NOTHING
          `, [blockId, r.unit_id, r.check_in, r.check_out, r.notes || r.channel_remarks || 'Закрито в Hostex', r.hostex_reservation_code]);
          await t.run('DELETE FROM reservations WHERE id = ?', [r.id]);
        });
      }
      console.log(`[Hostex] Migrated ${blockedRes.length} blocked reservations → availability_blocks`);
    }
  } catch (e: any) {
    console.warn('[Hostex] Blocked reservation migration note:', e.message);
  }
}

async function logSync(syncType: string, status: string, count: number, error?: string) {
  const sql = getSql();
  await sql.run(`
    INSERT INTO hostex_sync_log (sync_type, status, records_synced, error_message, started_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [syncType, status, count, error || null]);
}

// ─── Property map seeding ─────────────────────────────────

export async function seedPropertyMap(): Promise<{ unmapped: { id: number; title: string; channels: string[] }[] }> {
  const sql = getSql();
  ensureHostexColumns();

  const properties = await getProperties();
  const unmapped: { id: number; title: string; channels: string[] }[] = [];

  for (const prop of properties) {
    const unitId = (await mapHostexProperty(prop.id))?.unitId;
    if (unitId) {
      // created_at stays out of the SET list on purpose: OR REPLACE used to
      // delete the row and re-default it on every seed run, so the mapping
      // always looked freshly created.
      await sql.run(`
        INSERT INTO hostex_property_map (hostex_property_id, hostex_title, unit_id, channels)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (hostex_property_id) DO UPDATE SET
          hostex_title = excluded.hostex_title,
          unit_id      = excluded.unit_id,
          channels     = excluded.channels
      `, [prop.id, prop.title, unitId, JSON.stringify(prop.channels)]);
      console.log(`[Hostex] Mapped: ${prop.title} (${prop.id}) → ${unitId}`);
    } else {
      const channelTypes = (prop.channels || []).map((c: any) => c.channel_type);
      console.warn(`[Hostex] UNMAPPED PROPERTY: "${prop.title}" (id=${prop.id}) channels=${JSON.stringify(channelTypes)}`);
      unmapped.push({ id: prop.id, title: prop.title, channels: channelTypes });
    }
  }

  return { unmapped };
}

// ─── Get sync status ──────────────────────────────────────

export async function getSyncStatus(): Promise<{ lastSync: any; recentLogs: any[] }> {
  const sql = getSql();
  try {
    const lastSync = await sql.row<any>('SELECT * FROM hostex_sync_log ORDER BY id DESC LIMIT 1');
    const recentLogs = await sql.rows<any>('SELECT * FROM hostex_sync_log ORDER BY id DESC LIMIT 20');
    return { lastSync, recentLogs };
  } catch {
    return { lastSync: null, recentLogs: [] };
  }
}
