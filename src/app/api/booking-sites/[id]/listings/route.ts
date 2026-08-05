/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getSessionUser, getSessionIdFromCookies } from '@core/auth';

// GET /api/booking-sites/[id]/listings
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionUser(getSessionIdFromCookies(req.headers.get('cookie')));
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const sql = getSql();

    const site = await sql.row<any>("SELECT id FROM booking_sites WHERE id = ? AND status != 'deleted'", [id]);
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });

    // UTC, because that is what SQLite's date('now') returned here.
    const today = new Date().toISOString().slice(0, 10);

    const listings = await sql.rows<any>(`
      SELECT
        sl.*,
        u.name  AS unit_name,
        u.code  AS unit_code,
        ut.name AS unit_type_name,
        ut.code AS unit_type_code,
        ut.photos AS unit_type_photos,
        ut.id AS actual_unit_type_id,
        (
          SELECT MIN(pc.base_price)
          FROM price_calendar pc
          WHERE pc.unit_type_id = ut.id
            AND pc.date >= ?
            AND pc.closed = 0
        ) AS base_price
      FROM site_listings sl
      LEFT JOIN units u      ON sl.unit_id      = u.id
      LEFT JOIN unit_types ut ON COALESCE(sl.unit_type_id, u.unit_type_id) = ut.id
      WHERE sl.site_id = ?
      ORDER BY sl.sort_order, sl.created_at
    `, [today, id]);

    return NextResponse.json({ listings });
  } catch (error: any) {
    console.error('GET /api/booking-sites/[id]/listings error:', error?.message);
    return NextResponse.json({ error: 'Failed to fetch listings' }, { status: 500 });
  }
}

// POST /api/booking-sites/[id]/listings
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionUser(getSessionIdFromCookies(request.headers.get('cookie')));
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const sql = getSql();
    const body = await request.json();

    const site = await sql.row<any>("SELECT id FROM booking_sites WHERE id = ? AND status != 'deleted'", [id]);
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });

    const items: any[] = Array.isArray(body) ? body : [body];
    const created: any[] = [];

    for (const item of items) {
      const { unit_id, unit_type_id, price_override, rules_override, max_inventory, external_url } = item;

      if (!unit_id && !unit_type_id) {
        return NextResponse.json({ error: 'unit_id або unit_type_id обовʼязковий' }, { status: 400 });
      }
      if (unit_id && unit_type_id) {
        return NextResponse.json({ error: 'Вкажіть лише unit_id або unit_type_id, не обидва' }, { status: 400 });
      }

      const existing = await sql.row<any>(
        'SELECT id FROM site_listings WHERE site_id = ? AND (unit_id = ? OR unit_type_id = ?)',
        [id, unit_id || null, unit_type_id || null]
      );
      if (existing) continue;

      // No transaction around the loop: the items are independent, and a bad one
      // already bails out with a 400 while the rows before it stay added.
      // RETURNING rather than a read back by rowid: Postgres has no rowid.
      const row = await sql.row<any>(`
        INSERT INTO site_listings (site_id, unit_id, unit_type_id, price_override, rules_override, max_inventory, external_url)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `, [id, unit_id || null, unit_type_id || null, price_override ?? null, rules_override ?? null, max_inventory ?? null, external_url ?? null]);

      created.push(row);
    }

    return NextResponse.json({ listings: created }, { status: 201 });
  } catch (error: any) {
    if (error?.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Оголошення вже додано до цього сайту' }, { status: 409 });
    }
    console.error('POST /api/booking-sites/[id]/listings error:', error?.message);
    return NextResponse.json({ error: 'Failed to add listing' }, { status: 500 });
  }
}
