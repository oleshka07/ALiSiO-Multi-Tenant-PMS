/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getDb } from '@core/db';
import type { Actor } from '@core/auth/session';

/**
 * The published price list the embedded widget reads.
 *
 * The GET is public — the widget runs on the customer's own website — so the
 * caller has to say which hotel it is asking about. Unqualified, it returned
 * every hotel's price list in one array, and the PUT edited whichever row id
 * it was handed.
 */

/** The organization behind a public request, from the site the widget names. */
function organizationForSite(db: any, site: string | null, propertyId: string | null): string | null {
  if (propertyId) {
    const row = db.prepare('SELECT organization_id FROM properties WHERE id = ? AND is_active = 1')
      .get(propertyId) as any;
    return row?.organization_id ?? null;
  }
  if (!site) return null;
  const row = db.prepare(`
    SELECT p.organization_id
    FROM booking_sites s
    JOIN properties p ON p.id = s.property_id
    WHERE (s.id = ? OR s.slug = ?) AND s.status != 'deleted'
  `).get(site, site) as any;
  return row?.organization_id ?? null;
}

// GET — the price list of one hotel (public, read-only)
export async function getWidgetPriceList(req: Request) {
  try {
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const organizationId = organizationForSite(
      db,
      searchParams.get('siteId') || searchParams.get('site'),
      searchParams.get('propertyId'),
    );

    if (!organizationId) {
      return NextResponse.json({ error: 'siteId or propertyId is required' }, { status: 400 });
    }

    const rows = category
      ? db.prepare(
          'SELECT * FROM widget_price_list WHERE organization_id = ? AND category = ? ORDER BY sort_order',
        ).all(organizationId, category)
      : db.prepare(
          'SELECT * FROM widget_price_list WHERE organization_id = ? ORDER BY category, sort_order',
        ).all(organizationId);

    return NextResponse.json(rows);
  } catch (err: any) {
    console.error('GET /api/widget/prices error:', err?.message || err);
    return NextResponse.json({ error: 'Failed to fetch prices' }, { status: 500 });
  }
}

// GET (session) — the caller's own price list, for the dashboard. The public
// GET needs a site because it has no session; this one does not.
export async function listOwnWidgetPrices(_req: Request, actor: Actor) {
  try {
    const rows = getDb().prepare(
      'SELECT * FROM widget_price_list WHERE organization_id = ? ORDER BY category, sort_order',
    ).all(actor.organizationId);
    return NextResponse.json(rows);
  } catch (err: any) {
    console.error('GET /api/pricing/widget-list error:', err?.message || err);
    return NextResponse.json({ error: 'Failed to fetch prices' }, { status: 500 });
  }
}

// PUT — update a price item (session, manage_pricing)
export async function updateWidgetPriceItem(req: Request, actor: Actor) {
  try {
    const db = getDb();
    const body = await req.json();
    const { id, rate_standard, rate_holiday, rate_side_season, item_name, unit_label, notes, is_active } = body;

    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const res = db.prepare(`
      UPDATE widget_price_list
      SET rate_standard = COALESCE(?, rate_standard),
          rate_holiday = ?,
          rate_side_season = ?,
          item_name = COALESCE(?, item_name),
          unit_label = COALESCE(?, unit_label),
          notes = ?,
          is_active = COALESCE(?, is_active),
          updated_at = datetime('now')
      WHERE id = ? AND organization_id = ?
    `).run(
      rate_standard ?? null,
      rate_holiday ?? null,
      rate_side_season ?? null,
      item_name ?? null,
      unit_label ?? null,
      notes ?? null,
      is_active ?? null,
      id,
      actor.organizationId,
    );

    if (res.changes === 0) {
      return NextResponse.json({ error: 'Не знайдено' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('PUT /api/pricing/widget-list error:', err?.message || err);
    return NextResponse.json({ error: 'Failed to update price' }, { status: 500 });
  }
}
