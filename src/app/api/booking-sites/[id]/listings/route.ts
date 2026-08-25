/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { serverError } from '@core/http/errors';
import { withOwnedSite } from '../../_owned-site';

// GET /api/booking-sites/[id]/listings
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await withOwnedSite(req.headers.get('cookie'), id, async () => {
      const sql = getSql();
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
    });
  } catch (error: any) {
    return serverError('app/api/booking-sites/[id]/listings GET', error, 'Failed to fetch listings');
  }
}

// POST /api/booking-sites/[id]/listings
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();

    return await withOwnedSite(request.headers.get('cookie'), id, async ({ organizationId }) => {
      const sql = getSql();
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

        // The unit ids come from the request body, so they are checked against
        // this organization before being written. Owning the SITE does not make
        // a room yours: without this, a listing could point a hotel's own site
        // at somebody else's room and sell it.
        if (unit_id) {
          const owned = await sql.row<any>(`
            SELECT u.id FROM units u
            JOIN properties p ON u.property_id = p.id
            WHERE u.id = ? AND p.organization_id = ?`, [unit_id, organizationId]);
          if (!owned) return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
        }
        if (unit_type_id) {
          const owned = await sql.row<any>(`
            SELECT ut.id FROM unit_types ut
            JOIN properties p ON ut.property_id = p.id
            WHERE ut.id = ? AND p.organization_id = ?`, [unit_type_id, organizationId]);
          if (!owned) return NextResponse.json({ error: 'Unit type not found' }, { status: 404 });
        }

        const existing = await sql.row<any>(
          'SELECT id FROM site_listings WHERE site_id = ? AND (unit_id = ? OR unit_type_id = ?)',
          [id, unit_id || null, unit_type_id || null],
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
    });
  } catch (error: any) {
    if (error?.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Оголошення вже додано до цього сайту' }, { status: 409 });
    }
    return serverError('app/api/booking-sites/[id]/listings POST', error, 'Failed to add listing');
  }
}
