/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
// TODO: move to @core/translate or emit event for translation
import { extractTexts, translateAndStore } from '@core/i18n/translate';

export async function listPropertyGuestConfigs() {
  try {
    const sql = getSql();
    const configs = await sql.rows<any>(`
      SELECT pgc.*, p.name as property_name, p.slug as property_slug
      FROM property_guest_config pgc
      JOIN properties p ON pgc.property_id = p.id
      ORDER BY p.name
    `);
    return NextResponse.json(configs);
  } catch (error: any) {
    console.error('GET /api/property-guest-config error:', error?.message);
    return NextResponse.json({ error: 'Failed to fetch configs' }, { status: 500 });
  }
}

export async function updatePropertyGuestConfig(request: NextRequest) {
  try {
    const sql = getSql();
    const body = await request.json();
    const { property_id } = body;
    if (!property_id) {
      return NextResponse.json({ error: 'property_id required' }, { status: 400 });
    }

    const existing = await sql.row<any>('SELECT id FROM property_guest_config WHERE property_id = ?', [property_id]);

    const fields = [
      'wifi_network', 'wifi_password', 'restaurant_name', 'restaurant_hours', 'restaurant_menu_url',
      'rules', 'useful_info', 'faq_items', 'maps_url', 'territory_map_url',
      'pets_policy', 'parking_info', 'parking_photo_url', 'video_guide_url', 'emergency_phone',
      'weather_lat', 'weather_lon',
    ];

    if (existing) {
      const sets: string[] = [];
      const values: any[] = [];
      for (const f of fields) {
        if (body[f] !== undefined) {
          sets.push(`${f} = ?`);
          values.push(typeof body[f] === 'object' ? JSON.stringify(body[f]) : body[f]);
        }
      }
      if (sets.length > 0) {
        sets.push("updated_at = datetime('now')");
        values.push(property_id);
        await sql.run(`UPDATE property_guest_config SET ${sets.join(', ')} WHERE property_id = ?`, [...values]);
      }
    } else {
      await sql.run(`
        INSERT INTO property_guest_config (property_id, wifi_network, wifi_password, restaurant_name, restaurant_hours, restaurant_menu_url, rules, useful_info, faq_items, maps_url, territory_map_url, pets_policy, parking_info, video_guide_url, emergency_phone, weather_lat, weather_lon)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [property_id,
        body.wifi_network || 'ALiSiO_Guest', body.wifi_password || '',
        body.restaurant_name || '', body.restaurant_hours || '', body.restaurant_menu_url || null,
        typeof body.rules === 'object' ? JSON.stringify(body.rules) : body.rules || '[]',
        typeof body.useful_info === 'object' ? JSON.stringify(body.useful_info) : body.useful_info || '[]',
        typeof body.faq_items === 'object' ? JSON.stringify(body.faq_items) : body.faq_items || '[]',
        body.maps_url || null, body.territory_map_url || null,
        body.pets_policy || 'welcome', body.parking_info || '', body.video_guide_url || null,
        body.emergency_phone || null, body.weather_lat || null, body.weather_lon || null]);
    }

    const updated = await sql.row<any>('SELECT * FROM property_guest_config WHERE property_id = ?', [property_id]);

    const texts = extractTexts(updated);
    translateAndStore(texts).catch(e => console.error('[translate] bg error:', e?.message));

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('PUT /api/property-guest-config error:', error?.message);
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
  }
}
