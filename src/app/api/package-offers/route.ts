/**
 * GET  /api/package-offers?site_id=xxx  — список бандлів
 * POST /api/package-offers              — створити бандл
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { serverError } from '@core/http/errors';

/**
 * `site_id` arrives in the query string and in the body, and it is not a
 * secret — the widget publishes it. Both handlers took it on trust: GET listed
 * another hotel's package offers with their prices, and POST wrote a new
 * bundle onto another hotel's site, filing it under THAT hotel's organization
 * through the subselect below. The fix is the same in both places: resolve the
 * site against the caller's organization first.
 */
async function ownedSiteId(organizationId: string, siteId: string): Promise<boolean> {
  const sql = getSql();
  return !!await sql.row(
    'SELECT id FROM booking_sites WHERE id = ? AND organization_id = ?', [siteId, organizationId]);
}

export const GET = withActor(async (req: NextRequest, _ctx: unknown, actor: Actor) => {
  try {
    const sql = getSql();
    const siteId = new URL(req.url).searchParams.get('site_id');
    if (!siteId) return NextResponse.json({ error: 'site_id required' }, { status: 400 });
    if (!await ownedSiteId(actor.organizationId, siteId)) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    const bundles = await sql.rows(`
      SELECT b.*,
        COUNT(v.id) as issued_count,
        SUM(CASE WHEN v.status = 'activated' THEN 1 ELSE 0 END) as activated_count
      FROM gift_card_bundles b
      LEFT JOIN gift_cards v ON v.bundle_id = b.id
      WHERE b.site_id = ? AND b.organization_id = ?
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `, [siteId, actor.organizationId]);

    return NextResponse.json({ bundles });
  } catch (err: unknown) {
    return serverError('app/api/package-offers GET', err, 'Не вдалося зібрати пакети');
  }
});

export const POST = withPermission('manage_sites', async (req: NextRequest, _ctx: unknown, actor: Actor) => {
  try {
    const sql = getSql();
    const body = await req.json();
    const {
      site_id, name, description, price, currency = 'CZK',
      nights_included = 0, listing_type,
      included_services = [], validity_months = 12,
      allowed_days, coupon_code, redemption_limit, applied_listings, allowed_promo_codes,
    } = body;

    if (!site_id || !name || price === undefined) {
      return NextResponse.json({ error: 'site_id, name, price required' }, { status: 400 });
    }
    if (!await ownedSiteId(actor.organizationId, String(site_id))) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    // RETURNING * rather than RETURNING id plus a SELECT: the row it hands back
    // is the row that was just written, defaults and all.
    const bundle = await sql.row(`
      -- organization_id, from the site the bundle is sold on.
      INSERT INTO gift_card_bundles
        (organization_id, site_id, name, description, price, currency, nights_included,
         listing_type, included_services, validity_months, allowed_days,
         coupon_code, redemption_limit, applied_listings, allowed_promo_codes)
      VALUES ((SELECT organization_id FROM booking_sites WHERE id = ?),?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      RETURNING *
    `, [
      site_id, site_id, name, description || null, Number(price), currency,
      Number(nights_included), listing_type || null,
      JSON.stringify(included_services), Number(validity_months),
      allowed_days ? JSON.stringify(allowed_days) : null,
      coupon_code ? String(coupon_code).trim().toUpperCase() : null,
      redemption_limit !== undefined ? Number(redemption_limit) : 1,
      applied_listings && applied_listings.length > 0 ? JSON.stringify(applied_listings) : null,
      allowed_promo_codes && allowed_promo_codes.length > 0 ? JSON.stringify(allowed_promo_codes) : null,
    ]);
    return NextResponse.json({ bundle }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
});
