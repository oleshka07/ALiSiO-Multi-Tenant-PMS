/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateGuestToken } from '@core/db';
import { parseICal, extractGuestName } from '@/modules/channels/domain/ical'; // TODO: move to @core/ical
import { requireOrganizationId } from '@core/auth/tenant-context';
import { getSql } from '@core/db/async';
import { withPermission } from '@core/auth/session';
import { serverError } from '@core/http/errors';

export const syncIcal = withPermission('manage_properties', async (request: NextRequest) => {
  try {
    const sql = getSql();
    const body = await request.json().catch(() => ({}));
    const { channel_id } = body as { channel_id?: string };

    let channels: any[];
    if (channel_id) {
      const ch = await sql.row<any>('SELECT * FROM ical_channels WHERE id = ? AND is_active = TRUE', [channel_id]) as any;
      if (!ch) return NextResponse.json({ error: 'Channel not found or inactive' }, { status: 404 });
      channels = [ch];
    } else {
      channels = await sql.rows<any>('SELECT * FROM ical_channels WHERE is_active = TRUE AND ical_url IS NOT NULL') as any[];
    }

    const results: any[] = [];
    for (const channel of channels) {
      const result = await syncChannel(channel);
      results.push(result);
    }

    return NextResponse.json({ synced: results.length, results });
  } catch (e: any) {
    console.error('[iCal Sync] Error:', e);
    return serverError('modules/channels/api/ical-sync syncIcal', e);
  }
});

async function syncChannel(channel: any) {
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

    const org = { id: await requireOrganizationId() } as any;

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
