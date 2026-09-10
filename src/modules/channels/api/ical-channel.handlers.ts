/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withPermission, type Actor } from '@core/auth/session';
import { serverError } from '@core/http/errors';
import { ALL_PROPERTIES, propertyScopeFilter } from '@core/property-scope';

/**
 * One iCal channel, by id. Both handlers wrote `WHERE id = ?`; the tenant
 * reaches this table through `property_id`. So a user with
 * `manage_properties` at one hotel could repoint another hotel's import URL —
 * feeding it fabricated bookings that block its rooms — or delete the channel
 * outright. `ownedChannel` is that join, asked once.
 */
/**
 * Вісь обʼєкта — навмисно `ALL_PROPERTIES`: рядок каналу і Є носієм осі.
 *
 * Канал читається за первинним ключем, і саме він каже, якому будинку
 * належить. Звузити цей запит по будинку можна було б лише взявши будинок із
 * нього самого. Належність доводить `p.organization_id`, а правка й видалення
 * нижче йдуть уже по знайденому рядку (INC-029, К19).
 */
const CHANNEL_IS_THE_AXIS = propertyScopeFilter(ALL_PROPERTIES, 'ic');

async function ownedChannel(organizationId: string, id: string): Promise<any | undefined> {
  const sql = getSql();
  return await sql.row<any>(`
    SELECT ic.* FROM ical_channels ic
    JOIN properties p ON ic.property_id = p.id
    WHERE ic.id = ? AND p.organization_id = ? AND ${CHANNEL_IS_THE_AXIS.sql}
  `, [id, organizationId, ...CHANNEL_IS_THE_AXIS.params]);
}

export const updateIcalChannel = withPermission('manage_properties', async (request: Request,
  { params }: { params: Promise<{ id: string }> }, actor: Actor) => {
  try {
    const { id } = await params;
    const sql = getSql();
    const body = await request.json();

    const existing = await ownedChannel(actor.organizationId, id);
    if (!existing) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    const { ical_url, source_code, sync_interval_minutes, is_active } = body;

    await sql.run(`
      UPDATE ical_channels SET
        ical_url = ?,
        source_code = ?,
        sync_interval_minutes = ?,
        is_active = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND property_id = ?
    `, [ical_url ?? existing.ical_url,
      source_code ?? existing.source_code,
      sync_interval_minutes ?? existing.sync_interval_minutes,
      is_active ?? existing.is_active,
      id, existing.property_id]);

    const updated = await ownedChannel(actor.organizationId, id);
    return NextResponse.json(updated);
  } catch (e: any) {
    return serverError('modules/channels/api/ical-channel updateIcalChannel', e);
  }
});

export const deleteIcalChannel = withPermission('manage_properties', async (_request: Request,
  { params }: { params: Promise<{ id: string }> }, actor: Actor) => {
  try {
    const { id } = await params;
    const sql = getSql();

    const existing = await ownedChannel(actor.organizationId, id);
    if (!existing) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    await sql.run('DELETE FROM ical_sync_log WHERE channel_id = ?', [id]);
    await sql.run('DELETE FROM ical_channels WHERE id = ? AND property_id = ?', [id, existing.property_id]);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return serverError('modules/channels/api/ical-channel deleteIcalChannel', e);
  }
});
