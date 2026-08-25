/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getSessionUser, getSessionIdFromCookies } from '@core/auth';
import { requirePropertyId, propertyErrorStatus, runWithOrganization } from '@core/auth/tenant-context';
import { serverError } from '@core/http/errors';

// GET /api/booking-sites — list all sites for property
export async function GET(_req: NextRequest) {
  try {
    const session = await getSessionUser(getSessionIdFromCookies(_req.headers.get('cookie')));
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sql = getSql();
    // Scoped, and as the organization. This listed every booking site on the
    // server: the WHERE clause named only the status, so one hotel's operator
    // saw every other hotel's sites by name and slug.
    const sites = await runWithOrganization(session.organization_id, () => sql.rows<any>(`
      SELECT
        bs.*,
        (SELECT COUNT(*) FROM site_listings sl WHERE sl.site_id = bs.id) as listings_count
      FROM booking_sites bs
      WHERE bs.organization_id = ? AND bs.status != 'deleted'
      ORDER BY bs.created_at DESC
    `, [session.organization_id]));

    return NextResponse.json({ sites });
  } catch (error: any) {
    console.error('GET /api/booking-sites error:', error?.message);
    return NextResponse.json({ error: 'Failed to fetch sites' }, { status: 500 });
  }
}

// POST /api/booking-sites — create new site
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionUser(getSessionIdFromCookies(request.headers.get('cookie')));
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // This route reads the session itself rather than going through a guard,
    // so nothing had established the tenant: requirePropertyId could still be
    // told which property explicitly, but every write below ran unscoped, and
    // on Postgres each one was refused by its policy.
    return runWithOrganization(session.organization_id, async () => {

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
    });
  } catch (error: any) {
    console.error('POST /api/booking-sites error:', error);
    return serverError('app/api/booking-sites POST', error, 'Failed to create site');
  }
}
