/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { serverError } from '@core/http/errors';
import { withOwnedSite } from '../../../_owned-site';

/**
 * A listing belongs to a site, and the site is proven this hotel's first.
 * `AND site_id = ?` was already here and was doing real work — but only
 * relative to a site nobody had checked the ownership of.
 */

// PATCH /api/booking-sites/[id]/listings/[listingId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; listingId: string }> }
) {
  try {
    const { id, listingId } = await params;
    const body = await request.json();

    return await withOwnedSite(request.headers.get('cookie'), id, async () => {
    const sql = getSql();

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

    values.push(listingId, id);
    await sql.run(`UPDATE site_listings SET ${setClauses.join(', ')} WHERE id = ? AND site_id = ?`, values);

    const updated = await sql.row<any>('SELECT * FROM site_listings WHERE id = ? AND site_id = ?', [listingId, id]);
    return NextResponse.json({ listing: updated });
    });
  } catch (error: any) {
    return serverError('app/api/booking-sites/[id]/listings/[listingId] PATCH', error, 'Failed to update listing');
  }
}

// DELETE /api/booking-sites/[id]/listings/[listingId]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; listingId: string }> }
) {
  try {
    const { id, listingId } = await params;

    return await withOwnedSite(req.headers.get('cookie'), id, async () => {
    const sql = getSql();

    const listing = await sql.row<any>(
      'SELECT id FROM site_listings WHERE id = ? AND site_id = ?', [listingId, id]
    );
    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });

    await sql.run('DELETE FROM site_listings WHERE id = ? AND site_id = ?', [listingId, id]);
    return NextResponse.json({ success: true });
    });
  } catch (error: any) {
    return serverError('app/api/booking-sites/[id]/listings/[listingId] DELETE', error, 'Failed to delete listing');
  }
}
