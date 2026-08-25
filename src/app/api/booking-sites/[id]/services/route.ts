/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { serverError } from '@core/http/errors';
import { withOwnedSite } from '../../_owned-site';

// GET /api/booking-sites/[id]/services
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await withOwnedSite(req.headers.get('cookie'), id, async ({ organizationId }) => {
    const sql = getSql();

    // The service catalogue is scoped too. `additional_services` belongs to a
    // property, and without the join this listed every service on the server —
    // so one hotel's site-services screen offered the neighbour's spa
    // treatments, at the neighbour's prices, ready to be enabled.
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
      JOIN properties p ON s.property_id = p.id
      LEFT JOIN site_services ss ON ss.service_id = s.id AND ss.site_id = ?
      WHERE s.is_active = TRUE AND p.organization_id = ?
      ORDER BY COALESCE(ss.sort_order, s.sort_order), s.sort_order
    `, [id, organizationId]);

    return NextResponse.json({ services });
    });
  } catch (error: any) {
    return serverError('app/api/booking-sites/[id]/services GET', error, 'Failed to fetch services');
  }
}

// POST /api/booking-sites/[id]/services — toggle enable/disable + price_override
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { service_id, is_enabled, price_override, photo_override } = body;

    if (!service_id) {
      return NextResponse.json({ error: 'service_id обовʼязковий' }, { status: 400 });
    }

    return await withOwnedSite(request.headers.get('cookie'), id, async ({ organizationId }) => {
    const sql = getSql();

    // service_id comes from the request body, so it is checked against this
    // organization: owning the site does not make the service yours.
    const service = await sql.row<any>(`
      SELECT s.id FROM additional_services s
      JOIN properties p ON s.property_id = p.id
      WHERE s.id = ? AND s.is_active = TRUE AND p.organization_id = ?`,
      [service_id, organizationId]);
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
    });
  } catch (error: any) {
    return serverError('app/api/booking-sites/[id]/services POST', error, 'Failed to update service');
  }
}
