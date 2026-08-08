/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getSessionUser, getSessionIdFromCookies } from '@core/auth';

// GET /api/booking-sites/[id]/services
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionUser(getSessionIdFromCookies(req.headers.get('cookie')));
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const sql = getSql();

    const site = await sql.row<any>("SELECT id FROM booking_sites WHERE id = ? AND status != 'deleted'", [id]);
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });

    const services = await sql.rows<any>(`
      SELECT
        s.id, s.name, s.name_en, s.name_cs, s.icon,
        s.service_type, s.price, s.currency, s.unit_label,
        s.sort_order AS global_sort_order,
        COALESCE(ss.is_enabled, TRUE)    AS is_enabled,
        ss.price_override,
        ss.photo_override,
        COALESCE(ss.sort_order, s.sort_order) AS sort_order,
        ss.id AS site_service_id
      FROM additional_services s
      LEFT JOIN site_services ss ON ss.service_id = s.id AND ss.site_id = ?
      WHERE s.is_active = TRUE
      ORDER BY COALESCE(ss.sort_order, s.sort_order), s.sort_order
    `, [id]);

    return NextResponse.json({ services });
  } catch (error: any) {
    console.error('GET /api/booking-sites/[id]/services error:', error?.message);
    return NextResponse.json({ error: 'Failed to fetch services' }, { status: 500 });
  }
}

// POST /api/booking-sites/[id]/services — toggle enable/disable + price_override
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionUser(getSessionIdFromCookies(request.headers.get('cookie')));
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const sql = getSql();
    const body = await request.json();
    const { service_id, is_enabled, price_override, photo_override } = body;

    if (!service_id) {
      return NextResponse.json({ error: 'service_id обовʼязковий' }, { status: 400 });
    }

    const site = await sql.row<any>("SELECT id FROM booking_sites WHERE id = ? AND status != 'deleted'", [id]);
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });

    const service = await sql.row<any>('SELECT id FROM additional_services WHERE id = ? AND is_active = TRUE', [service_id]);
    if (!service) return NextResponse.json({ error: 'Service not found' }, { status: 404 });

    await sql.run(`
      INSERT INTO site_services (site_id, service_id, is_enabled, price_override, photo_override)
      VALUES (?, ?, ?, ?, COALESCE(?, (SELECT photo_override FROM site_services WHERE site_id = ? AND service_id = ?)))
      ON CONFLICT(site_id, service_id) DO UPDATE SET
        is_enabled     = excluded.is_enabled,
        price_override = excluded.price_override,
        photo_override = COALESCE(?, site_services.photo_override)
    `, [id, service_id, is_enabled !== false ? 1 : 0, price_override ?? null, photo_override, id, service_id, photo_override]);

    const updated = await sql.row<any>(
      'SELECT * FROM site_services WHERE site_id = ? AND service_id = ?', [id, service_id]
    );

    return NextResponse.json({ service: updated });
  } catch (error: any) {
    console.error('POST /api/booking-sites/[id]/services error:', error?.message);
    return NextResponse.json({ error: 'Failed to update service' }, { status: 500 });
  }
}
