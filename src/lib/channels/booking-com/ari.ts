/**
 * Booking.com ARI (Availability, Rates, Inventory) Push Client
 * 
 * Pushes inventory, rates, and restrictions to Booking.com via OTA XML.
 * All calls authenticated via JWT, rate-limited, and RUID-logged.
 */

import { getDb } from '@/lib/db';
import { authenticatedFetch } from '../auth';
import { withRateLimit } from '../rate-limiter';
import { logSyncRequest, extractRUID } from '../ruid-logger';
import {
  buildHotelInvNotif,
  buildHotelRateAmountNotif,
  buildRestrictions,
  buildHotelDescriptiveInfoRequest,
} from '../xml/ota-builder';
import { isSuccessResponse, parseErrorResponse } from '../xml/ota-parser';
import { BOOKING_COM_URLS } from '../types';
import type { ARIInventoryUpdate, ARIRateUpdate, ARIRestrictionUpdate, SyncResult, EnvironmentType } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Get the environment for a connection (test or production)
 */
function getEnvironment(connectionId: string): EnvironmentType {
  const db = getDb();
  const row = db.prepare(`
    SELECT cred.environment
    FROM channel_connections cc
    JOIN channel_credentials cred ON cc.credentials_id = cred.id
    WHERE cc.id = ?
  `).get(connectionId) as any;
  return (row?.environment as EnvironmentType) || 'test';
}

/**
 * Get the external property ID for a connection
 */
function getPropertyId(connectionId: string): string {
  const db = getDb();
  const row = db.prepare('SELECT external_property_id FROM channel_connections WHERE id = ?').get(connectionId) as any;
  if (!row?.external_property_id) {
    throw new Error(`Connection ${connectionId}: external_property_id not configured`);
  }
  return row.external_property_id;
}

// ─── Push Inventory ──────────────────────────────────────────

/**
 * Push inventory (available room count) to Booking.com
 */
export async function pushInventory(
  connectionId: string,
  updates: ARIInventoryUpdate[],
): Promise<SyncResult> {
  const env = getEnvironment(connectionId);
  const hotelCode = getPropertyId(connectionId);
  const baseUrl = BOOKING_COM_URLS[env].supply;
  const endpoint = `${baseUrl}/ota/OTA_HotelInvNotif`;

  const xmlBody = buildHotelInvNotif(hotelCode, updates);
  return sendOTARequest(connectionId, endpoint, '/ota/OTA_HotelInvNotif', xmlBody, updates.length);
}

// ─── Push Rates ──────────────────────────────────────────────

/**
 * Push rates (Standard pricing) to Booking.com
 */
export async function pushRates(
  connectionId: string,
  rates: ARIRateUpdate[],
): Promise<SyncResult> {
  const env = getEnvironment(connectionId);
  const hotelCode = getPropertyId(connectionId);
  const baseUrl = BOOKING_COM_URLS[env].supply;
  const endpoint = `${baseUrl}/ota/OTA_HotelRateAmountNotif`;

  const xmlBody = buildHotelRateAmountNotif(hotelCode, rates);
  return sendOTARequest(connectionId, endpoint, '/ota/OTA_HotelRateAmountNotif', xmlBody, rates.length);
}

// ─── Push Restrictions ───────────────────────────────────────

/**
 * Push restrictions (min_stay, max_stay, closed, CTA, CTD)
 */
export async function pushRestrictions(
  connectionId: string,
  restrictions: ARIRestrictionUpdate[],
): Promise<SyncResult> {
  const env = getEnvironment(connectionId);
  const hotelCode = getPropertyId(connectionId);
  const baseUrl = BOOKING_COM_URLS[env].supply;
  const endpoint = `${baseUrl}/ota/OTA_HotelInvNotif`;

  const xmlBody = buildRestrictions(hotelCode, restrictions);
  return sendOTARequest(connectionId, endpoint, '/ota/OTA_HotelInvNotif', xmlBody, restrictions.length);
}

// ─── Read-back ───────────────────────────────────────────────

/**
 * Read back current state from Booking.com for verification
 */
export async function readBack(connectionId: string): Promise<string> {
  const env = getEnvironment(connectionId);
  const hotelCode = getPropertyId(connectionId);
  const baseUrl = BOOKING_COM_URLS[env].supply;
  const endpoint = `${baseUrl}/ota/OTA_HotelDescriptiveInfo`;

  const xmlBody = buildHotelDescriptiveInfoRequest(hotelCode);
  const startTime = Date.now();

  const response = await withRateLimit('/ota/OTA_HotelDescriptiveInfo', async () => {
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
    endpoint: '/ota/OTA_HotelDescriptiveInfo',
    requestBody: xmlBody,
    responseStatus: response.status,
    responseBody,
    ruid,
    durationMs: Date.now() - startTime,
  });

  return responseBody;
}

// ─── Full Year Push ──────────────────────────────────────────

/**
 * Build ARI updates from PMS price_calendar for a unit type + date range.
 * Returns the 3 types of updates needed by Booking.com.
 */
export function buildARIFromPriceCalendar(
  connectionId: string,
  unitTypeId: string,
  dateFrom: string,
  dateTo: string,
): { inventory: ARIInventoryUpdate[]; rates: ARIRateUpdate[]; restrictions: ARIRestrictionUpdate[] } {
  const db = getDb();

  // Get mapping for this unit type
  const mapping = db.prepare(`
    SELECT external_room_type_id, external_rate_plan_id
    FROM channel_room_mapping
    WHERE connection_id = ? AND unit_type_id = ? AND is_active = 1
  `).get(connectionId, unitTypeId) as any;

  if (!mapping || !mapping.external_room_type_id) {
    return { inventory: [], rates: [], restrictions: [] };
  }

  const roomTypeId = mapping.external_room_type_id;
  const ratePlanId = mapping.external_rate_plan_id || 'STD';

  // Get price calendar data
  const prices = db.prepare(`
    SELECT * FROM price_calendar
    WHERE unit_type_id = ? AND date >= ? AND date <= ?
    ORDER BY date
  `).all(unitTypeId, dateFrom, dateTo) as any[];

  // Count total units of this type
  const unitCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM units WHERE unit_type_id = ?
  `).get(unitTypeId) as any;
  const totalUnits = unitCount?.cnt || 1;

  // Count occupied units per date
  const occupancy = db.prepare(`
    SELECT r.check_in, r.check_out
    FROM reservations r
    JOIN units u ON r.unit_id = u.id
    WHERE u.unit_type_id = ?
      AND r.status NOT IN ('cancelled', 'no_show')
      AND r.check_in <= ? AND r.check_out > ?
  `).all(unitTypeId, dateTo, dateFrom) as any[];

  // Build occupancy map
  const occupancyMap = new Map<string, number>();
  for (const res of occupancy) {
    let d = new Date(res.check_in);
    const end = new Date(res.check_out);
    while (d < end) {
      const ds = d.toISOString().slice(0, 10);
      occupancyMap.set(ds, (occupancyMap.get(ds) || 0) + 1);
    d.setDate(d.getDate() + 1);
    }
  }

  const inventory: ARIInventoryUpdate[] = [];
  const rates: ARIRateUpdate[] = [];
  const restrictions: ARIRestrictionUpdate[] = [];

  for (const p of prices) {
    const occupied = occupancyMap.get(p.date) || 0;
    const available = Math.max(0, totalUnits - occupied);
    const dayOfWeek = new Date(p.date).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
    const effectivePrice = isWeekend && p.weekend_price != null ? p.weekend_price : p.base_price;

    inventory.push({
      roomTypeId,
      dateFrom: p.date,
      dateTo: p.date,
      totalCount: totalUnits,
      availableCount: available,
    });

    if (effectivePrice > 0) {
      rates.push({
        roomTypeId,
        ratePlanId,
        dateFrom: p.date,
        dateTo: p.date,
        basePrice: effectivePrice,
        weekendPrice: p.weekend_price,
        currency: 'CZK', // TODO: make configurable per connection
      });
    }

    restrictions.push({
      roomTypeId,
      ratePlanId,
      dateFrom: p.date,
      dateTo: p.date,
      minStay: p.min_stay || 1,
      maxStay: p.max_stay || null,
      closed: !!p.closed,
      closedToArrival: !!p.cta,
      closedToDeparture: !!p.ctd,
    });
  }

  return { inventory, rates, restrictions };
}

// ─── Internal: Send OTA XML Request ──────────────────────────

async function sendOTARequest(
  connectionId: string,
  fullUrl: string,
  endpointPath: string,
  xmlBody: string,
  itemCount: number,
): Promise<SyncResult> {
  const startTime = Date.now();
  let ruid: string | null = null;
  let responseStatus: number | undefined;
  let responseBody: string | undefined;

  try {
    const response = await withRateLimit(endpointPath, async () => {
      return authenticatedFetch(connectionId, fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
        },
        body: xmlBody,
      });
    });

    responseStatus = response.status;
    ruid = extractRUID(response.headers);
    responseBody = await response.text();

    if (!response.ok) {
      const error = parseErrorResponse(responseBody);
      return {
        success: false,
        itemsProcessed: 0,
        errors: [{ code: String(response.status), message: error.errorMessage || `HTTP ${response.status}` }],
        ruid,
      };
    }

    const success = isSuccessResponse(responseBody);
    if (!success) {
      const error = parseErrorResponse(responseBody);
      return {
        success: false,
        itemsProcessed: 0,
        errors: [{ code: error.errorCode || 'UNKNOWN', message: error.errorMessage || 'Unknown error in response' }],
        ruid,
      };
    }

    return {
      success: true,
      itemsProcessed: itemCount,
      errors: [],
      ruid,
    };
  } catch (error: any) {
    return {
      success: false,
      itemsProcessed: 0,
      errors: [{ code: 'EXCEPTION', message: error.message || String(error) }],
      ruid,
    };
  } finally {
    logSyncRequest({
      connectionId,
      direction: 'outbound',
      endpoint: endpointPath,
      requestBody: xmlBody,
      responseStatus: responseStatus ?? null,
      responseBody: responseBody ?? null,
      ruid,
      durationMs: Date.now() - startTime,
    });
  }
}
