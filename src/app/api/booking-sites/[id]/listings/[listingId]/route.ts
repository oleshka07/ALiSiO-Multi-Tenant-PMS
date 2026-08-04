/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getSessionUser, getSessionIdFromCookies } from '@core/auth';

// PATCH /api/booking-sites/[id]/listings/[listingId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; listingId: string }> }
) {
  try {
    const session = getSessionUser(getSessionIdFromCookies(request.headers.get('cookie')));
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id, listingId } = await params;
    const sql = getSql();
    const body = await request.json();

    const listing = await sql.row<any>(
      'SELECT id FROM site_listings WHERE id = ? AND site_id = ?', [listingId, id]
    );
    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });

    const allowed = ['price_override', 'has_rules_override', 'rules_override', 'max_inventory', 'external_url', 'thank_you_url', 'default_lang', 'sort_order', 'photos'];
    const setClauses: string[] = [];
    const values: any[] = [];

    for (const key of allowed) {
      if (key in body) {
        setClauses.push(`${key} = ?`);
        values.push(body[key] ?? null);
      }
    }

    if (!setClauses.length) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    values.push(listingId);
    await sql.run(`UPDATE site_listings SET ${setClauses.join(', ')} WHERE id = ?`, values);

    const updated = await sql.row<any>('SELECT * FROM site_listings WHERE id = ?', [listingId]);
    return NextResponse.json({ listing: updated });
  } catch (error: any) {
    console.error('PATCH listing error:', error?.message);
    return NextResponse.json({ error: 'Failed to update listing' }, { status: 500 });
  }
}

// DELETE /api/booking-sites/[id]/listings/[listingId]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; listingId: string }> }
) {
  try {
    const session = getSessionUser(getSessionIdFromCookies(req.headers.get('cookie')));
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id, listingId } = await params;
    const sql = getSql();

    const listing = await sql.row<any>(
      'SELECT id FROM site_listings WHERE id = ? AND site_id = ?', [listingId, id]
    );
    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });

    await sql.run('DELETE FROM site_listings WHERE id = ?', [listingId]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE listing error:', error?.message);
    return NextResponse.json({ error: 'Failed to delete listing' }, { status: 500 });
  }
}
