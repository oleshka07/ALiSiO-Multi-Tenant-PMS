/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withActor, withPermission } from '@core/auth/session';
import { requireOrganizationId } from '@core/auth/tenant-context';

/* ─── GET /api/coupons?site_id=xxx ─── */
//
// Through the guard rather than a session lookup of its own. The check that was
// here proved WHO was calling and stopped there, so the query below ran with no
// organization — and it has none of its own either: `WHERE 1=1` filters by site
// and by rule, never by tenant. On SQLite that returned every hotel's promo
// codes to whoever asked. On Postgres the policy returned nobody's, including
// the caller's. The guard sets the tenant and the policy does the filtering.
export const GET = withActor(async (req: NextRequest) => {
  try {
    const sql = getSql();
    const url = new URL(req.url);
    const siteId = url.searchParams.get('site_id');
    const ruleId = url.searchParams.get('rule_id');

    let statement = 'SELECT * FROM coupons WHERE 1=1';
    const params: (string | number)[] = [];

    if (siteId) { statement += ' AND site_id = ?'; params.push(siteId); }
    if (ruleId) { statement += ' AND gift_card_rule_id = ?'; params.push(ruleId); }

    statement += ' ORDER BY created_at DESC';
    const codes = await sql.rows(statement, params);

    return NextResponse.json(codes);
  } catch (e: any) {
    console.error('GET /api/coupons error:', e?.message || e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
});

/* ─── POST /api/coupons ─── */
export const POST = withPermission('manage_sites', async (req: NextRequest) => {
  try {
    const body = await req.json();
    const {
      code, discount_type, offer_amount,
      valid_from, valid_until,
      min_nights, max_nights,
      redemption_limit, site_id,
      allowed_days,
      description,
      applies_to,
      applied_listings,
      applicable_services,
    } = body;

    if (!code || offer_amount === undefined || offer_amount === '') {
      return NextResponse.json({ error: 'code and offer_amount are required' }, { status: 400 });
    }

    const sql = getSql();

    const id = `promo_${Date.now()}`;
    await sql.run(`
      -- organization_id, named rather than left to the column DEFAULT: that
      -- DEFAULT is a Postgres mechanism (migration 0005) and on SQLite the
      -- coupon landed with a NULL tenant — created successfully, then invisible
      -- to the hotel that created it.
      INSERT INTO coupons
        (id, organization_id, code, description, discount_type, offer_amount,
         valid_from, valid_until,
         min_nights, max_nights,
         max_uses, redemption_limit,
         site_id, allowed_days, applies_to, applied_listings, applicable_services, is_active)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,TRUE)
    `, [
      id, await requireOrganizationId(),
      String(code).toUpperCase().trim(),
      description || null,
      discount_type || 'percentage',
      Number(offer_amount),
      valid_from || null,
      valid_until || null,
      min_nights ? Number(min_nights) : null,
      max_nights ? Number(max_nights) : null,
      redemption_limit ? Number(redemption_limit) : null,
      redemption_limit ? Number(redemption_limit) : null,
      site_id || null,
      allowed_days ? JSON.stringify(allowed_days) : null,
      applies_to || 'services',
      applied_listings ? JSON.stringify(applied_listings) : null,
      applicable_services ? JSON.stringify(applicable_services) : null,
    ]);

    const created = await sql.row('SELECT * FROM coupons WHERE id = ?', [id]);
    return NextResponse.json({ code: created }, { status: 201 });
  } catch (e: any) {
    if (e?.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Промокод з таким кодом вже існує' }, { status: 409 });
    }
    console.error('POST /api/coupons error:', e?.message || e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
});
