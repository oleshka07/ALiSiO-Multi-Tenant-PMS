/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
// TODO: move to @core/translate or emit event for translation
import { extractTexts, translateAndStore } from '@core/i18n/translate';
import { withActor } from '@core/auth/session';

/** Another tenant's unit type must look exactly like a missing one. */
async function ownsUnitType(organizationId: string, unitTypeId: string): Promise<boolean> {
  const sql = getSql();
  return !!await sql.row<any>(`
    SELECT ut.id FROM unit_types ut
    JOIN properties p ON p.id = ut.property_id
    WHERE ut.id = ? AND p.organization_id = ?
  `, [unitTypeId, organizationId]);
}

export const getGuestPageConfig = withActor(async (_request: NextRequest, { params }: { params: Promise<{ unitTypeId: string }> }, actor) => {
  try {
    const sql = getSql();
    const { unitTypeId } = await params;
    if (!await ownsUnitType(actor.organizationId, unitTypeId)) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    const config = await sql.row<any>(`
      SELECT gpc.*, ut.name as unit_type_name, ut.code as unit_type_code,
             c.type as category_type, c.name as category_name
      FROM guest_page_config gpc
      JOIN unit_types ut ON gpc.unit_type_id = ut.id
      JOIN categories c ON ut.category_id = c.id
      WHERE gpc.unit_type_id = ?
    `, [unitTypeId]);

    if (!config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    return NextResponse.json(config);
  } catch (error: any) {
    console.error('GET /api/guest-page-config/[unitTypeId] error:', error?.message);
    return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
  }
});

export const updateGuestPageConfig = withActor(async (request: NextRequest, { params }: { params: Promise<{ unitTypeId: string }> }, actor) => {
  try {
    const sql = getSql();
    const { unitTypeId } = await params;
    const body = await request.json();

    // This row carries the door code. The id arrives in the URL, so the
    // ownership check is the whole difference between "my room type" and
    // "any room type on the server".
    if (!await ownsUnitType(actor.organizationId, unitTypeId)) {
      return NextResponse.json({ error: 'Unit type not found' }, { status: 404 });
    }

    const existing = await sql.row<any>('SELECT id FROM guest_page_config WHERE unit_type_id = ?', [unitTypeId]);

    if (existing) {
      const sets: string[] = [];
      const values: any[] = [];

      const fields = ['amenities', 'check_in_instructions', 'external_amenities', 'faq_items', 'rules',
        'wifi_network', 'wifi_password', 'restaurant_name', 'restaurant_hours', 'restaurant_menu_url', 'useful_info',
        'lock_code', 'maps_url', 'territory_map_url', 'pets_policy', 'entry_photo_url'];

      for (const f of fields) {
        if (body[f] !== undefined) {
          sets.push(`${f} = ?`);
          values.push(typeof body[f] === 'object' ? JSON.stringify(body[f]) : body[f]);
        }
      }

      if (sets.length > 0) {
        sets.push("updated_at = CURRENT_TIMESTAMP");
        values.push(unitTypeId);
        await sql.run(`UPDATE guest_page_config SET ${sets.join(', ')} WHERE unit_type_id = ?`, [...values]);
      }
    } else {
      await sql.run(`
        INSERT INTO guest_page_config (unit_type_id, amenities, check_in_instructions, external_amenities, faq_items, rules,
          wifi_network, wifi_password, restaurant_name, restaurant_hours, restaurant_menu_url, useful_info,
          lock_code, maps_url, territory_map_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [unitTypeId,
        typeof body.amenities === 'object' ? JSON.stringify(body.amenities) : body.amenities || '[]',
        body.check_in_instructions || '',
        typeof body.external_amenities === 'object' ? JSON.stringify(body.external_amenities) : body.external_amenities || null,
        typeof body.faq_items === 'object' ? JSON.stringify(body.faq_items) : body.faq_items || '[]',
        typeof body.rules === 'object' ? JSON.stringify(body.rules) : body.rules || '[]',
        body.wifi_network || null,
        body.wifi_password || null,
        // No invented fallbacks: an unnamed restaurant, an unset door code
        // and an absent map are EMPTY, not the first customer's values. A new
        // hotel's guest page showing somebody's door code was the bug.
        body.restaurant_name || null,
        body.restaurant_hours || '',
        body.restaurant_menu_url || null,
        typeof body.useful_info === 'object' ? JSON.stringify(body.useful_info) : body.useful_info || '[]',
        body.lock_code || null,
        body.maps_url || null,
        body.territory_map_url || null]);
    }

    const updated = await sql.row<any>('SELECT * FROM guest_page_config WHERE unit_type_id = ?', [unitTypeId]);

    const texts = extractTexts(updated);
    translateAndStore(texts).catch(e => console.error('[translate] bg error:', e?.message));

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('PUT /api/guest-page-config/[unitTypeId] error:', error?.message);
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
  }
});
