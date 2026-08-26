/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateGuestToken } from '@core/db';
import { requirePropertyId, propertyErrorStatus, requireOrganizationId } from '@core/auth/tenant-context';
import { getSql } from '@core/db/async';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { serverError } from '@core/http/errors';

/**
 * iCal channels reach their tenant through `property_id`, and neither this
 * list nor the update/delete beside it mentioned it. The rows carry the import
 * URL a hotel got from its OTA and the export token that IS the credential for
 * its own calendar feed — hand that token to anyone and they read every
 * arrival, departure and guest name the feed contains, with no session at all.
 */
export const listIcalChannels = withActor(async (_request: NextRequest, _ctx: unknown, actor: Actor) => {
  try {
    const sql = getSql();
    const channels = await sql.rows<any>(`
      SELECT
        ic.*,
        CASE ic.channel_type
          WHEN 'building' THEN b.name
          WHEN 'unit' THEN u.name
        END as target_name,
        CASE ic.channel_type
          WHEN 'building' THEN b.code
          WHEN 'unit' THEN u.code
        END as target_code,
        bs.name as source_name,
        bs.color as source_color,
        bs.icon_letter as source_icon
      FROM ical_channels ic
      JOIN properties p ON ic.property_id = p.id
      LEFT JOIN buildings b ON ic.building_id = b.id
      LEFT JOIN units u ON ic.unit_id = u.id
      LEFT JOIN booking_sources bs ON bs.code = ic.source_code
      WHERE p.organization_id = ?
      ORDER BY ic.created_at
    `, [actor.organizationId]);

    for (const ch of channels as any[]) {
      ch.last_log = await sql.row<any>(
        'SELECT * FROM ical_sync_log WHERE channel_id = ? ORDER BY synced_at DESC LIMIT 1',
        [ch.id],
      ) || null;
    }

    return NextResponse.json(channels);
  } catch (e: any) {
    return serverError('modules/channels/api/ical-channels listIcalChannels', e);
  }
});

export const createIcalChannel = withPermission('manage_properties', async (request: NextRequest) => {
  try {
    const sql = getSql();
    const body = await request.json();
    const { channel_type, building_id, unit_id, source_code, ical_url, sync_interval_minutes } = body;

    if (!channel_type || !source_code) {
      return NextResponse.json({ error: 'channel_type and source_code are required' }, { status: 400 });
    }

    if (channel_type === 'building' && !building_id) {
      return NextResponse.json({ error: 'building_id is required for building channels' }, { status: 400 });
    }

    if (channel_type === 'unit' && !unit_id) {
      return NextResponse.json({ error: 'unit_id is required for unit channels' }, { status: 400 });
    }

    if (channel_type === 'building') {
      const dup = await sql.row<any>(
        `SELECT id FROM ical_channels WHERE building_id = ? AND source_code = ?
           AND property_id IN (SELECT id FROM properties WHERE organization_id = ?)`,
        [building_id, source_code, await requireOrganizationId()]);
      if (dup) return NextResponse.json({ error: 'Channel already exists for this building + source' }, { status: 400 });
    } else {
      const dup = await sql.row<any>(
        `SELECT id FROM ical_channels WHERE unit_id = ? AND source_code = ?
           AND property_id IN (SELECT id FROM properties WHERE organization_id = ?)`,
        [unit_id, source_code, await requireOrganizationId()]);
      if (dup) return NextResponse.json({ error: 'Channel already exists for this unit + source' }, { status: 400 });
    }

    let propertyId: string;
    try {
      propertyId = await requirePropertyId(body.property_id);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: propertyErrorStatus(e) });
    }

    const id = `ich_${Date.now()}`;
    const exportToken = generateGuestToken() + generateGuestToken();

    // The tenant is named, and taken from the property the channel hangs on —
    // a subquery cannot drift from the row it comes from. AGENTS.md §3 nr 12.
    await sql.run(`
      INSERT INTO ical_channels (id, organization_id, property_id, channel_type, building_id, unit_id, source_code, ical_url, export_token, sync_interval_minutes)
      VALUES (?, (SELECT organization_id FROM properties WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, propertyId, propertyId, channel_type,
      channel_type === 'building' ? building_id : null,
      channel_type === 'unit' ? unit_id : null,
      source_code, ical_url || null, exportToken,
      sync_interval_minutes || 15]);

    const created = await sql.row<any>(
      'SELECT * FROM ical_channels WHERE id = ? AND organization_id = ?',
      [id, await requireOrganizationId()]);
    // propertyId above came from requirePropertyId(), which resolves it
    // against this organization — so the row just written is this hotel's.
    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    return serverError('modules/channels/api/ical-channels createIcalChannel', e);
  }
});
