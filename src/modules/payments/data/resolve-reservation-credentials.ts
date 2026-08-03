/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import type { TeyaCredentials } from '../domain/types';
import { resolveSiteCredentials } from './site-credentials.repo';

/**
 * Resolve per-site Teya credentials for a given reservation.
 *
 * Looks up the reservation's `source` field:
 *   - Format `widget:<siteId>` → looks up booking_sites.payment_config
 *   - Other formats → returns undefined (caller falls back to ENV globals)
 *
 * This is used by guest-page payment handlers (pay-booking, pay services)
 * so that payments from guests booked through a specific site go to that
 * site's Teya store — matching the store used during initial checkout.
 */
export async function resolveCredentialsForReservation(reservationId: string): Promise<TeyaCredentials | undefined> {
  try {
    const sql = getSql();
    const row = await sql.row<{ source: string }>('SELECT source FROM reservations WHERE id = ?', [reservationId]);
    if (!row?.source) return undefined;

    // Extract site_id from "widget:<siteId>" format
    const match = row.source.match(/^widget:(.+)$/);
    if (!match) return undefined;

    const siteId = match[1];
    const resolved = await resolveSiteCredentials({ id: siteId });
    return resolved?.credentials ?? undefined;
  } catch (e: any) {
    console.error('[payments] resolveCredentialsForReservation error:', e.message);
    return undefined;
  }
}
