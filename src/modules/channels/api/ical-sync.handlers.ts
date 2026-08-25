/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateGuestToken } from '@core/db';
import { parseICal, extractGuestName } from '@/modules/channels/domain/ical'; // TODO: move to @core/ical
import { getSql } from '@core/db/async';
import { withPermission, type Actor } from '@core/auth/session';
import { serverError } from '@core/http/errors';

/**
 * Pull one iCal feed into the hotel's calendar.
 *
 * `syncChannel` is exported and takes the organization as an argument rather
 * than reading it from the request context. That is what lets the cron call it
 * — see `ical-cron.handlers.ts`, which used to HTTP-POST to this very route
 * with no cookie, get a 401 from `withPermission`, and not look at `res.ok`.
 * It then reported «Synced N channel(s)» every time. Automatic iCal sync — the
 * 5/15/30/60-minute interval the operator picks on screen — had never once run;
 * only the manual button worked.
 *
 * Two calls instead of a self-request also means one process, one transaction
 * boundary and no chance of the server refusing itself.
 */
export const syncIcal = withPermission('manage_properties', async (request: NextRequest, _ctx: unknown, actor: Actor) => {
  try {
    const sql = getSql();
    const body = await request.json().catch(() => ({}));
    const { channel_id } = body as { channel_id?: string };

    // Scoped, like everything else that takes a channel id from the client.
    let channels: any[];
    if (channel_id) {
      const ch = await sql.row<any>(`
        SELECT ic.* FROM ical_channels ic
        JOIN properties p ON ic.property_id = p.id
        WHERE ic.id = ? AND ic.is_active = TRUE AND p.organization_id = ?
      `, [channel_id, actor.organizationId]) as any;
      if (!ch) return NextResponse.json({ error: 'Channel not found or inactive' }, { status: 404 });
      channels = [ch];
    } else {
      channels = await sql.rows<any>(`
        SELECT ic.* FROM ical_channels ic
        JOIN properties p ON ic.property_id = p.id
        WHERE ic.is_active = TRUE AND ic.ical_url IS NOT NULL AND p.organization_id = ?
      `, [actor.organizationId]) as any[];
    }

    const results: any[] = [];
    for (const channel of channels) {
      const result = await syncChannel(channel, actor.organizationId);
      results.push(result);
    }

    return NextResponse.json({ synced: results.length, results });
  } catch (e: any) {
    console.error('[iCal Sync] Error:', e);
    return serverError('modules/channels/api/ical-sync syncIcal', e);
  }
});

export async function syncChannel(channel: any, organizationId: string) {
  const sql = getSql();
  const logId = `isl_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  try {
    if (!channel.ical_url) throw new Error('No iCal URL configured');

    const response = await fetch(channel.ical_url, {
      headers: { 'User-Agent': 'ALiSiO-ERP/1.0 iCal-Sync' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const icalText = await response.text();
    const events = parseICal(icalText);

    let eventsCreated = 0;
    let eventsUpdated = 0;

    const unitIds = await getChannelUnitIds(channel);
    if (unitIds.length === 0) throw new Error('No units found for this channel');

    const org = { id: organizationId };

    for (const event of events) {
      const externalUid = `ical_${channel.id}_${event.uid}`;
      const existing = await sql.row<any>('SELECT id, check_in, check_out FROM reservations WHERE external_uid = ?', [externalUid]) as any;

      if (existing) {
        const nights = Math.max(1, Math.round(
          (new Date(event.dtend).getTime() - new Date(event.dtstart).getTime()) / 86400000
        ));
        if (existing.check_in !== event.dtstart || existing.check_out !== event.dtend) {
          await sql.run(`
            UPDATE reservations SET check_in = ?, check_out = ?, nights = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [event.dtstart, event.dtend, nights, existing.id]);
          eventsUpdated++;
        }
      } else {
        const guestName = extractGuestName(event.summary);
        const firstName = guestName || 'OTA';
        const lastName = guestName ? channel.source_code.toUpperCase() : 'Blocked';

        const guestId = `g_ical_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)', [guestId, org.id, firstName, lastName]);

        const nights = Math.max(1, Math.round(
          (new Date(event.dtend).getTime() - new Date(event.dtstart).getTime()) / 86400000
        ));

        const targetUnitId = channel.channel_type === 'unit'
          ? channel.unit_id
          : await findAvailableUnit(unitIds, event.dtstart, event.dtend);

        const resId = `r_ical_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const guestPageToken = generateGuestToken();
        const unit = await sql.row<any>('SELECT property_id FROM units WHERE id = ?', [targetUnitId]) as any;

        await sql.run(`
          -- organization_id, named rather than left to the column DEFAULT: that
          -- DEFAULT reads app.organization_id and exists only on Postgres
          -- (migration 0005). On SQLite the row landed with a NULL tenant and
          -- every query that scopes by it found nothing. Taken from the
          -- property so it cannot disagree with it.
          INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id, check_in, check_out, nights,
            adults, children, status, payment_status, source, total_price, commission_amount,
            guest_page_token, external_uid, notes)
          VALUES (?, (SELECT organization_id FROM properties WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [resId, unit?.property_id || channel.property_id, unit?.property_id || channel.property_id, targetUnitId, guestId,
          event.dtstart, event.dtend, nights,
          1, 0, 'confirmed', 'paid', channel.source_code, 0, 0,
          guestPageToken, externalUid,
          `iCal import: ${event.summary}`]);

        eventsCreated++;
      }
    }

    await sql.run("UPDATE ical_channels SET last_synced_at = CURRENT_TIMESTAMP WHERE id = ?", [channel.id]);
    await sql.run(`
      INSERT INTO ical_sync_log (id, channel_id, status, events_found, events_created, events_updated)
      VALUES (?, ?, 'success', ?, ?, ?)
    `, [logId, channel.id, events.length, eventsCreated, eventsUpdated]);

    return { channel_id: channel.id, status: 'success', events_found: events.length, events_created: eventsCreated, events_updated: eventsUpdated };
  } catch (e: any) {
    await sql.run(`INSERT INTO ical_sync_log (id, channel_id, status, error_message) VALUES (?, ?, 'error', ?)`, [logId, channel.id, e.message]);
    return { channel_id: channel.id, status: 'error', error: e.message };
  }
}

async function getChannelUnitIds(channel: any): Promise<string[]> {
  const sql = getSql();
  if (channel.channel_type === 'unit') return [channel.unit_id];
  const units = await sql.rows<any>('SELECT id FROM units WHERE building_id = ?', [channel.building_id]) as any[];
  return units.map((u: any) => u.id);
}

async function findAvailableUnit(unitIds: string[], checkIn: string, checkOut: string): Promise<string> {
  const sql = getSql();
  for (const uid of unitIds) {
    const overlap = await sql.row<any>(`
      SELECT id FROM reservations
      WHERE unit_id = ? AND status NOT IN ('cancelled', 'no_show')
        AND check_in < ? AND check_out > ?
    `, [uid, checkOut, checkIn]);
    if (!overlap) return uid;
  }
  return unitIds[0];
}
