/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { secretAuthFailure } from '@core/security/cron-auth';

export async function runIcalCron(request: Request) {
  // The secret defaulted to 'alisio-ical-sync' — a password written in this
  // file. Unset now refuses instead: the container never received
  // ICAL_CRON_SECRET, so the default was the live value, not a dev shortcut.
  const denied = secretAuthFailure(request, 'ICAL_CRON_SECRET');
  if (denied) return denied;

  try {

    const sql = getSql();
    const channels = await sql.rows<any>(`
      SELECT * FROM ical_channels
      WHERE is_active = TRUE
        AND ical_url IS NOT NULL
        AND (
          last_synced_at IS NULL
          OR ${sql.dialect.plusMinutes('last_synced_at', 'sync_interval_minutes')} <= CURRENT_TIMESTAMP
        )
    `) as any[];

    if (channels.length === 0) {
      return NextResponse.json({ message: 'No channels need syncing', synced: 0 });
    }

    const baseUrl = new URL(request.url).origin;
    const results: any[] = [];

    for (const channel of channels) {
      try {
        const res = await fetch(`${baseUrl}/api/ical-sync/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel_id: channel.id }),
        });
        const data = await res.json();
        results.push(data);
      } catch (e: any) {
        results.push({ channel_id: channel.id, error: e.message });
      }
    }

    return NextResponse.json({
      message: `Synced ${channels.length} channel(s)`,
      synced: channels.length,
      results,
    });
  } catch (e: any) {
    console.error('[iCal Cron] Error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
