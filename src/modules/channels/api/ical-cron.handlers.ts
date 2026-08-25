/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { runWithOrganization } from '@core/auth/tenant-context';
import { secretAuthFailure } from '@core/security/cron-auth';
import { serverError } from '@core/http/errors';
import { syncChannel } from './ical-sync.handlers';

/**
 * The scheduled iCal pull. It had never run.
 *
 * This used to HTTP-POST to `/api/ical-sync/sync` — its own server, its own
 * route — with no cookie. That route is behind `withPermission`, so every
 * request came back 401. `res.ok` was never checked; `res.json()` parsed the
 * error body, pushed it into `results`, and the handler answered
 * «Synced N channel(s)» with N = the number of channels it had INTENDED to
 * sync. So the interval an operator picks on screen (5/15/30/60 minutes) did
 * nothing at all, the cron log said success, and only the manual button ever
 * imported anything.
 *
 * Now it calls `syncChannel` directly. That removes the self-request, and with
 * it the possibility of the server refusing itself — but it exposes the second
 * half of the bug, which the 401 had been hiding: a cron has no session, so it
 * has no tenant either. `syncChannel` writes guests and reservations, and on
 * Postgres every one of those writes is refused by row-level security when
 * `app.organization_id` is unset. Each channel therefore runs inside its own
 * organization's context, resolved from the property it belongs to.
 *
 * One channel failing does not stop the rest: an OTA feed that is down, or a
 * URL somebody typed wrong, must not hold up the other hotels' imports.
 */
export async function runIcalCron(request: Request) {
  // The secret defaulted to 'alisio-ical-sync' — a password written in this
  // file. Unset now refuses instead: the container never received
  // ICAL_CRON_SECRET, so the default was the live value, not a dev shortcut.
  const denied = secretAuthFailure(request, 'ICAL_CRON_SECRET');
  if (denied) return denied;

  try {
    const sql = getSql();
    // The organization comes back with the channel: the cron is outside any
    // tenant, so it has to be told, per row, whose calendar this is.
    const channels = await sql.rows<any>(`
      SELECT ic.*, p.organization_id
      FROM ical_channels ic
      JOIN properties p ON ic.property_id = p.id
      WHERE ic.is_active = TRUE
        AND ic.ical_url IS NOT NULL
        AND (
          ic.last_synced_at IS NULL
          OR ${sql.dialect.plusMinutes('ic.last_synced_at', 'ic.sync_interval_minutes')} <= CURRENT_TIMESTAMP
        )
    `) as any[];

    if (channels.length === 0) {
      return NextResponse.json({ message: 'No channels need syncing', synced: 0 });
    }

    const results: any[] = [];
    for (const channel of channels) {
      try {
        const result = await runWithOrganization(
          channel.organization_id,
          () => syncChannel(channel, channel.organization_id),
        );
        results.push(result);
      } catch (e: any) {
        // syncChannel already writes its own error row into ical_sync_log; this
        // catches a failure of the context itself.
        console.error(`[iCal Cron] channel ${channel.id}:`, e?.message);
        results.push({ channel_id: channel.id, status: 'error', error: 'sync failed' });
      }
    }

    // Counted from what happened, not from what was attempted. The old number
    // was `channels.length` regardless of outcome, which is exactly how a cron
    // that never worked kept reporting that it had.
    const succeeded = results.filter((r) => r?.status === 'success').length;
    const failed = results.length - succeeded;

    return NextResponse.json({
      message: `Synced ${succeeded} of ${channels.length} channel(s)`,
      synced: succeeded,
      failed,
      results,
    });
  } catch (e: any) {
    console.error('[iCal Cron] Error:', e);
    return serverError('modules/channels/api/ical-cron runIcalCron', e);
  }
}
