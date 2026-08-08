/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { runWithOrganization } from '@core/auth/tenant-context';
import type { Actor } from '@core/auth/session';

/**
 * The published price list the embedded widget reads.
 *
 * The GET is public — the widget runs on the customer's own website — so the
 * caller has to say which hotel it is asking about. Unqualified, it returned
 * every hotel's price list in one array, and the PUT edited whichever row id
 * it was handed.
 */

/**
 * The organization behind a public request, from the site the widget names.
 *
 * Read off `booking_sites` alone, never through `properties`.
 *
 * `booking_sites` is one of the two tables readable before a tenant is known
 * (READ_BEFORE_TENANT in scripts/pg-schema.mjs) — it has to be, because a guest
 * is not a tenant and the widget arrives with a public site key and nothing
 * else. `properties` is not, and must not be: it is the name, city and address
 * of every hotel on the server.
 *
 * So both lookups used to go through a table the caller cannot read. The join
 * matched nothing, this returned null, and the public price list answered
 * "siteId or propertyId is required" to a request that named its site
 * perfectly well — for every hotel, from the day prod moved to Postgres.
 * `booking_sites` carries its own organization_id for exactly this reason.
 *
 * A property is addressable publicly only if some booking site points at it,
 * which is the right rule: a property with no site has no widget.
 */
async function organizationForSite(site: string | null, propertyId: string | null): Promise<string | null> {
  const sql = getSql();
  if (propertyId) {
    const row = await sql.row<any>(
      "SELECT organization_id FROM booking_sites WHERE property_id = ? AND status != 'deleted' LIMIT 1",
      [propertyId],
    ) as any;
    return row?.organization_id ?? null;
  }
  if (!site) return null;
  const row = await sql.row<any>(
    "SELECT organization_id FROM booking_sites WHERE (id = ? OR slug = ?) AND status != 'deleted'",
    [site, site],
  ) as any;
  return row?.organization_id ?? null;
}

// GET — the price list of one hotel (public, read-only)
export async function getWidgetPriceList(req: Request) {
  try {
    const sql = getSql();
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const organizationId = await organizationForSite(searchParams.get('siteId') || searchParams.get('site'),
      searchParams.get('propertyId'),
    );

    if (!organizationId) {
      return NextResponse.json({ error: 'siteId or propertyId is required' }, { status: 400 });
    }

    // As the hotel the site names. The WHERE clause below already says which
    // organization, and on SQLite that was the whole story; on Postgres the
    // row-level policy also has to be told, or the answer is an empty list.
    const rows = await runWithOrganization(organizationId, () => (category
      ? sql.rows<any>('SELECT * FROM widget_price_list WHERE organization_id = ? AND category = ? ORDER BY sort_order', [organizationId, category])
      : sql.rows<any>('SELECT * FROM widget_price_list WHERE organization_id = ? ORDER BY category, sort_order', [organizationId])));

    return NextResponse.json(rows);
  } catch (err: any) {
    console.error('GET /api/widget/prices error:', err?.message || err);
    return NextResponse.json({ error: 'Failed to fetch prices' }, { status: 500 });
  }
}

// GET (session) — the caller's own price list, for the dashboard. The public
// GET needs a site because it has no session; this one does not.
export async function listOwnWidgetPrices(_req: Request, actor: Actor) {
  const sql = getSql();
  try {
    const rows = await sql.rows<any>('SELECT * FROM widget_price_list WHERE organization_id = ? ORDER BY category, sort_order', [actor.organizationId]);
    return NextResponse.json(rows);
  } catch (err: any) {
    console.error('GET /api/pricing/widget-list error:', err?.message || err);
    return NextResponse.json({ error: 'Failed to fetch prices' }, { status: 500 });
  }
}

// PUT — update a price item (session, manage_pricing)
export async function updateWidgetPriceItem(req: Request, actor: Actor) {
  try {
    const sql = getSql();
    const body = await req.json();
    const { id, rate_standard, rate_holiday, rate_side_season, item_name, unit_label, notes, is_active } = body;

    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const res = await sql.run(`
      UPDATE widget_price_list
      SET rate_standard = COALESCE(?, rate_standard),
          rate_holiday = ?,
          rate_side_season = ?,
          item_name = COALESCE(?, item_name),
          unit_label = COALESCE(?, unit_label),
          notes = ?,
          is_active = COALESCE(?, is_active),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?
    `, [rate_standard ?? null,
      rate_holiday ?? null,
      rate_side_season ?? null,
      item_name ?? null,
      unit_label ?? null,
      notes ?? null,
      is_active ?? null,
      id,
      actor.organizationId]);

    if (res.changes === 0) {
      return NextResponse.json({ error: 'Не знайдено' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('PUT /api/pricing/widget-list error:', err?.message || err);
    return NextResponse.json({ error: 'Failed to update price' }, { status: 500 });
  }
}
