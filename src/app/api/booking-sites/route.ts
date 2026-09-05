/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withModule, type Actor } from '@core/auth/session';
import { requirePropertyId, propertyErrorStatus } from '@core/auth/tenant-context';
import { serverError } from '@core/http/errors';

// GET /api/booking-sites — list all sites for property
//
// Під `booking_engine`, а не під `sites` (П15): список сайтів читає екран
// коду віджета, щоб назвати сайт у вставці, — а форма бронювання не платна.
// Створення і все редагування сайта — платний модуль `sites` (POST нижче і
// `withOwnedSite` для `[id]/**`).
export const GET = withModule('booking_engine', null, async (_req: NextRequest, _ctx: unknown, actor: Actor) => {
  try {
    const session = { organization_id: actor.organizationId, id: actor.user.id };
    const sql = getSql();
    // Scoped, and as the organization. This listed every booking site on the
    // server: the WHERE clause named only the status, so one hotel's operator
    // saw every other hotel's sites by name and slug.
    const sites = await sql.rows<any>(`
      SELECT
        bs.*,
        (SELECT COUNT(*) FROM site_listings sl WHERE sl.site_id = bs.id) as listings_count
      FROM booking_sites bs
      WHERE bs.organization_id = ? AND bs.status != 'deleted'
      ORDER BY bs.created_at DESC
    `, [session.organization_id]);

    return NextResponse.json({ sites });
  } catch (error: any) {
    console.error('GET /api/booking-sites error:', error?.message);
    return NextResponse.json({ error: 'Failed to fetch sites' }, { status: 500 });
  }
});

// POST /api/booking-sites — create new site (платний модуль `sites`, П15)
export const POST = withModule('sites', 'nav:sites', async (request: NextRequest, _ctx: unknown, actor: Actor) => {
  try {
    const session = { organization_id: actor.organizationId, id: actor.user.id };
    // `withModule` вже встановив особу й орендаря (раніше маршрут читав сесію
    // сам, і кожен запис нижче йшов без контексту — на Postgres політика їх
    // відхиляла).
    const sql = getSql();
    const body = await request.json();
    const { name, type = 'self-hosted', currency = 'CZK', property_id } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Назва сайту обовʼязкова' }, { status: 400 });
    }

    // The property must be this organization's: unqualified, this attached a
    // new booking site to whichever property the server created first.
    let propId: string;
    try {
      propId = await requirePropertyId(property_id);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: propertyErrorStatus(e) });
    }

    const defaultDesignConfig = JSON.stringify({
      theme: 'Classical',
      primary_color: '#A2845E',
      button_style: 'rounded_filled',
      show_shadow: true,
      logo_url: null,
      favicon_url: null,
    });

    const defaultWidgetConfig = JSON.stringify({
      search_result_url: '/',
      enable_prefill: false,
    });

    let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `site-${Date.now()}`;
    
    // Ensure slug uniqueness
    const existing = await sql.row<any>('SELECT id FROM booking_sites WHERE slug = ?', [slug]);
    if (existing) {
      slug = `${slug}-${Math.random().toString(36).substring(2, 5)}`;
    }

    // organization_id is stored rather than reached through the property: the
    // widget resolves this row before any tenant is known, so it has to name
    // its own organization. See the migration in core/db.
    const organizationId = session.organization_id;

    // RETURNING rather than a read back by rowid: Postgres has no rowid.
    const site = await sql.row<any>(`
      INSERT INTO booking_sites (organization_id, property_id, name, slug, type, currency, design_config, widget_config, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `, [organizationId, propId, name.trim(), slug, type, currency, defaultDesignConfig, defaultWidgetConfig, session.id]);

    return NextResponse.json({ site }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/booking-sites error:', error);
    return serverError('app/api/booking-sites POST', error, 'Failed to create site');
  }
});
