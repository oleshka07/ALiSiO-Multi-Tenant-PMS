/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@core/db';
import {
  buildHotelInvNotif, buildHotelRateAmountNotif, buildRestrictions, buildResNotifAcknowledge,
  parseResNotifResponse, parseErrorResponse,
  getQueueStats, getRateLimitStats, getAllSyncLogs, getCredentialsStatus,
} from '@/lib/channels';

export async function testChannels(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const module = searchParams.get('module') || 'all';
  const results: Record<string, any> = {};

  try {
    if (module === 'all' || module === 'db') {
      const db = getDb();
      const tables = ['channel_connections', 'channel_credentials', 'channel_room_mapping', 'ari_sync_queue', 'ari_sync_log'];
      const tableStatus: Record<string, boolean> = {};
      for (const t of tables) {
        tableStatus[t] = !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
      }
      const resColumns = db.prepare('PRAGMA table_info(reservations)').all() as any[];
      const newCols = ['bcom_reservation_id', 'price_per_night_json', 'smoking_preference', 'promotions_applied', 'rate_rewriting_info', 'cancellation_policy', 'meal_plan'];
      const colStatus: Record<string, boolean> = {};
      for (const col of newCols) colStatus[col] = resColumns.some((c: any) => c.name === col);
      results.db = { tables: tableStatus, reservationColumns: colStatus };
    }

    if (module === 'all' || module === 'xml') {
      const inventoryXml = buildHotelInvNotif('12345', [{ roomTypeId: 'RT_STEALTH', dateFrom: '2026-04-01', dateTo: '2026-04-02', totalCount: 3, availableCount: 2 }]);
      const rateXml = buildHotelRateAmountNotif('12345', [{ roomTypeId: 'RT_STEALTH', ratePlanId: 'STD', dateFrom: '2026-04-01', dateTo: '2026-04-02', basePrice: 2500, weekendPrice: 3000, currency: 'CZK' }]);
      const restrictionXml = buildRestrictions('12345', [{ roomTypeId: 'RT_STEALTH', ratePlanId: 'STD', dateFrom: '2026-04-01', dateTo: '2026-04-02', minStay: 2, maxStay: 14, closed: false, closedToArrival: false, closedToDeparture: false }]);
      const ackXml = buildResNotifAcknowledge(['RES_001', 'RES_002']);
      const sampleResXml = `<?xml version="1.0" encoding="UTF-8"?><OTA_HotelResNotifRQ><HotelReservations><HotelReservation ResStatus="Commit" CreateDateTime="2026-03-20T10:00:00Z"><UniqueID Type="14" ID="4012345678"/><ResGuests><ResGuest><PersonName><GivenName>Jan</GivenName><Surname>Novák</Surname></PersonName><Email>jan@example.com</Email></ResGuest></ResGuests><GuestCounts><GuestCount AgeQualifyingCode="10" Count="2"/></GuestCounts><RoomStays><RoomStay RoomTypeCode="RT_STEALTH"><RatePlan RatePlanCode="STD" RatePlanName="Standard"/><TimeSpan Start="2026-04-01" End="2026-04-03"/><Rates><Rate EffectiveDate="2026-04-01"><BaseByGuestAmts><BaseByGuestAmt AmountAfterTax="2500.00" CurrencyCode="CZK"/></BaseByGuestAmts></Rate></Rates><Total AmountAfterTax="2500.00" CurrencyCode="CZK"/></RoomStay></RoomStays></HotelReservation></HotelReservations></OTA_HotelResNotifRQ>`;
      const parsedReservations = parseResNotifResponse(sampleResXml);
      results.xml = {
        builder: { inventoryXmlLength: inventoryXml.length, rateXmlLength: rateXml.length, restrictionXmlLength: restrictionXml.length, ackXmlLength: ackXml.length, sampleInventoryXml: inventoryXml.substring(0, 500) },
        parser: { parsedCount: parsedReservations.length, firstReservation: parsedReservations[0] || null, errorCheck: parseErrorResponse(sampleResXml) },
      };
    }

    if (module === 'all' || module === 'queue') results.queue = getQueueStats();
    if (module === 'all' || module === 'ratelimit') results.rateLimiter = getRateLimitStats();
    if (module === 'all' || module === 'logs') results.syncLogs = getAllSyncLogs({ limit: 5 });
    if (module === 'all' || module === 'auth') results.auth = getCredentialsStatus('');

    return NextResponse.json({ status: 'ok', message: 'Channel Manager modules loaded successfully', timestamp: new Date().toISOString(), results });
  } catch (error: any) {
    return NextResponse.json({ status: 'error', message: error.message, stack: process.env.NODE_ENV === 'development' ? error.stack : undefined }, { status: 500 });
  }
}
