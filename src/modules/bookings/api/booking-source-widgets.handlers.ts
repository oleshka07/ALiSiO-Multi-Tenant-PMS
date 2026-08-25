/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { serverError } from '@core/http/errors';

/**
 * GET /api/booking-sources/widget-sites
 *
 * Returns all active booking_sites as pseudo-sources for the CRM booking form.
 * Each site is represented as a BookingSourceRow-compatible object so the
 * BookingForm dropdown can render them under an "Widgets" optgroup.
 *
 * The `code` is prefixed with `widget:` so the backend can distinguish
 * widget-originated manual entries from regular OTA sources.
 */
export async function listWidgetSiteSources() {
  try {
    const sql = getSql();

    // Guard: table may not exist in older DBs. Filtered here rather than in
    // SQL — the catalogue column is called `tablename` on Postgres and `name`
    // on SQLite, and only the output alias is shared.
    const tableExists = (await sql.rows<any>(sql.dialect.tables()) as { name: string }[])
      .some((t) => t.name === 'booking_sites');

    if (!tableExists) {
      return NextResponse.json([]);
    }

    const sites = await sql.rows<any>(`
      SELECT id, name, slug, site_url, status
      FROM booking_sites
      WHERE status != 'deleted'
      ORDER BY name
    `) as any[];

    const rows = sites.map((s) => ({
      code: `widget:${s.id}`,
      name: s.name || s.slug || s.id,
      color: '#6366f1',        // indigo — consistent "widget" brand colour
      icon_letter: '🌐',
      commission_percent: 0,
      city_tax_included_default: 0,
      site_url: s.site_url || null,
      site_id: s.id,
    }));

    return NextResponse.json(rows);
  } catch (e: any) {
    return serverError('modules/bookings/api/booking-source-widgets listWidgetSiteSources', e);
  }
}
