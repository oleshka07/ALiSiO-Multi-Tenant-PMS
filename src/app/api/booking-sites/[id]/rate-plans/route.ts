/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { serverError } from '@core/http/errors';
import { withOwnedSite } from '../../_owned-site';

// GET /api/booking-sites/[id]/rate-plans
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await withOwnedSite(req.headers.get('cookie'), id, async () => {
    const sql = getSql();

    const plans = await sql.rows<any>(`
      SELECT * FROM site_rate_plans
      WHERE site_id = ? AND is_active = TRUE
      ORDER BY is_default DESC, created_at ASC
    `, [id]);

    for (const plan of plans) {
      try { plan.payment_schedule = JSON.parse(plan.payment_schedule); } catch { /* */ }
      try { plan.meals_included = JSON.parse(plan.meals_included); } catch { /* */ }
      try { plan.applied_listings = JSON.parse(plan.applied_listings); } catch { /* */ }
      try { plan.valid_weekdays = plan.valid_weekdays ? JSON.parse(plan.valid_weekdays) : null; } catch { /* */ }
    }

    return NextResponse.json({ plans });
    });
  } catch (error: any) {
    return serverError('app/api/booking-sites/[id]/rate-plans GET', error, 'Failed to fetch rate plans');
  }
}

// POST /api/booking-sites/[id]/rate-plans
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();

    return await withOwnedSite(request.headers.get('cookie'), id, async () => {
    const sql = getSql();

    const {
      name,
      is_default = 0,
      cancellation_policy = 'non_refundable',
      payment_schedule = [{ percent: 100, trigger: 'on_booking' }],
      meals_included = [],
      min_days_before_checkin = 0,
      same_day_cutoff_hour = null,
      min_stay = 1,
      max_stay = 999,
      pricing_mode = 'independent',
      pricing_modifier_percent = null,
      pricing_modifier_type = 'less',
      derived_from_plan_id = null,
      valid_weekdays = null,
      applied_listings = [],
    } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Назва тарифу обовʼязкова' }, { status: 400 });
    }

    const validPolicies = ['non_refundable', 'full_refund', 'flexible'];
    if (!validPolicies.includes(cancellation_policy)) {
      return NextResponse.json({ error: 'Невірна політика скасування' }, { status: 400 });
    }

    if (is_default) {
      await sql.run('UPDATE site_rate_plans SET is_default = FALSE WHERE site_id = ?', [id]);
    }

    // Normalise legacy 'derived' value → 'dependent' (DB CHECK constraint)
    const safePricingMode = pricing_mode === 'derived' ? 'dependent' : pricing_mode;

    // RETURNING rather than a read back by rowid: Postgres has no rowid.
    const plan = await sql.row<any>(`
      INSERT INTO site_rate_plans (
        site_id, name, is_default, cancellation_policy, payment_schedule,
        meals_included, min_days_before_checkin, same_day_cutoff_hour,
        min_stay, max_stay, pricing_mode, applied_listings,
        pricing_modifier_percent, pricing_modifier_type, derived_from_plan_id, valid_weekdays
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `, [
      id, name.trim(), is_default ? 1 : 0, cancellation_policy,
      JSON.stringify(payment_schedule),
      JSON.stringify(meals_included),
      min_days_before_checkin, same_day_cutoff_hour,
      min_stay, max_stay, safePricingMode,
      JSON.stringify(applied_listings),
      pricing_modifier_percent, pricing_modifier_type, derived_from_plan_id,
      valid_weekdays ? JSON.stringify(valid_weekdays) : null
    ]);
    try { plan.payment_schedule = JSON.parse(plan.payment_schedule); } catch { /* */ }
    try { plan.meals_included = JSON.parse(plan.meals_included); } catch { /* */ }
    try { plan.applied_listings = JSON.parse(plan.applied_listings); } catch { /* */ }
    try { plan.valid_weekdays = plan.valid_weekdays ? JSON.parse(plan.valid_weekdays) : null; } catch { /* */ }

    return NextResponse.json({ plan }, { status: 201 });
    });
  } catch (error: any) {
    return serverError('app/api/booking-sites/[id]/rate-plans POST', error, 'Failed to create rate plan');
  }
}
