/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getSessionUser, getSessionIdFromCookies } from '@core/auth';

// GET /api/booking-sites/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = getSessionUser(getSessionIdFromCookies(req.headers.get('cookie')));
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const sql = getSql();
    const site = await sql.row<any>(
      "SELECT * FROM booking_sites WHERE id = ? AND status != 'deleted'", [id]
    );

    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });

    if (site.design_config) {
      try { site.design_config = JSON.parse(site.design_config); } catch { /* leave as string */ }
    }
    if (site.widget_config) {
      try { site.widget_config = JSON.parse(site.widget_config); } catch { /* leave as string */ }
    }

    return NextResponse.json({ site });
  } catch (error: any) {
    console.error('GET /api/booking-sites/[id] error:', error?.message);
    return NextResponse.json({ error: 'Failed to fetch site' }, { status: 500 });
  }
}

// PATCH /api/booking-sites/[id]
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = getSessionUser(getSessionIdFromCookies(request.headers.get('cookie')));
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const sql = getSql();
    const body = await request.json();

    const site = await sql.row<any>(
      "SELECT * FROM booking_sites WHERE id = ? AND status != 'deleted'", [id]
    );
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });

    const allowed = ['name', 'slug', 'site_url', 'type', 'currency', 'status', 'design_config', 'widget_config', 'allowed_domains'];
    const setClauses: string[] = ["updated_at = CURRENT_TIMESTAMP"];
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

    values.push(id);
    await sql.run(`UPDATE booking_sites SET ${setClauses.join(', ')} WHERE id = ?`, values);

    const updated = await sql.row<any>('SELECT * FROM booking_sites WHERE id = ?', [id]);
    if (updated.design_config) {
      try { updated.design_config = JSON.parse(updated.design_config); } catch { /* */ }
    }
    if (updated.widget_config) {
      try { updated.widget_config = JSON.parse(updated.widget_config); } catch { /* */ }
    }

    return NextResponse.json({ site: updated });
  } catch (error: any) {
    console.error('PATCH /api/booking-sites/[id] error:', error?.message);
    return NextResponse.json({ error: 'Failed to update site' }, { status: 500 });
  }
}

// DELETE /api/booking-sites/[id] — soft delete
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = getSessionUser(getSessionIdFromCookies(req.headers.get('cookie')));
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const sql = getSql();

    const site = await sql.row<any>(
      "SELECT id FROM booking_sites WHERE id = ? AND status != 'deleted'", [id]
    );
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });

    await sql.run(
      "UPDATE booking_sites SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/booking-sites/[id] error:', error?.message);
    return NextResponse.json({ error: 'Failed to delete site' }, { status: 500 });
  }
}
