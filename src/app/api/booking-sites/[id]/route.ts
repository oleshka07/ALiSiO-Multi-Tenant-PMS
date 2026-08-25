/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { serverError } from '@core/http/errors';
import { withOwnedSite } from '../_owned-site';

/**
 * One booking site. See `../_owned-site.ts` for what was wrong here: no tenant
 * context and `WHERE id = ?`, over an id the widget publishes.
 */

function parseConfigs(site: any) {
  for (const key of ['design_config', 'widget_config']) {
    if (site?.[key]) {
      try { site[key] = JSON.parse(site[key]); } catch { /* leave as string */ }
    }
  }
  return site;
}

// GET /api/booking-sites/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await withOwnedSite(req.headers.get('cookie'), id, async ({ site }) =>
      NextResponse.json({ site: parseConfigs(site) }));
  } catch (error: any) {
    return serverError('app/api/booking-sites/[id] GET', error, 'Failed to fetch site');
  }
}

// PATCH /api/booking-sites/[id]
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();

    return await withOwnedSite(request.headers.get('cookie'), id, async ({ organizationId }) => {
      const sql = getSql();
      const allowed = ['name', 'slug', 'site_url', 'type', 'currency', 'status', 'design_config', 'widget_config', 'allowed_domains'];
      const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP'];
      const values: any[] = [];

      for (const key of allowed) {
        if (key in body) {
          setClauses.push(`${key} = ?`);
          const val = body[key];
          values.push(typeof val === 'object' && val !== null ? JSON.stringify(val) : val);
        }
      }

      if (setClauses.length === 1) {
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
      }

      // organization_id in the WHERE as well as in the ownership read above:
      // the read proves the caller may touch this row, this makes the write
      // unable to reach any other one even if that read is ever loosened.
      values.push(id, organizationId);
      await sql.run(
        `UPDATE booking_sites SET ${setClauses.join(', ')} WHERE id = ? AND organization_id = ?`,
        values,
      );

      const updated = await sql.row<any>(
        'SELECT * FROM booking_sites WHERE id = ? AND organization_id = ?', [id, organizationId]);
      return NextResponse.json({ site: parseConfigs(updated) });
    });
  } catch (error: any) {
    return serverError('app/api/booking-sites/[id] PATCH', error, 'Failed to update site');
  }
}

// DELETE /api/booking-sites/[id] — soft delete
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await withOwnedSite(req.headers.get('cookie'), id, async ({ organizationId }) => {
      const sql = getSql();
      await sql.run(
        "UPDATE booking_sites SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?",
        [id, organizationId],
      );
      return NextResponse.json({ success: true });
    });
  } catch (error: any) {
    return serverError('app/api/booking-sites/[id] DELETE', error, 'Failed to delete site');
  }
}
