/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { serverError } from '@core/http/errors';
import { withOwnedSite } from '../../../_owned-site';

// PATCH /api/booking-sites/[id]/rate-plans/[planId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> }
) {
  try {
    const { id, planId } = await params;
    const body = await request.json();

    return await withOwnedSite(request.headers.get('cookie'), id, async () => {
    const sql = getSql();

    const plan = await sql.row<any>('SELECT * FROM site_rate_plans WHERE id = ? AND site_id = ?', [planId, id]);
    if (!plan) return NextResponse.json({ error: 'Rate plan not found' }, { status: 404 });

    if (body.is_default) {
      await sql.run('UPDATE site_rate_plans SET is_default = FALSE WHERE site_id = ?', [id]);
    }

    const jsonFields = ['payment_schedule', 'meals_included', 'applied_listings', 'valid_weekdays'];
    const allowed = [
      'name', 'is_default', 'cancellation_policy', 'payment_schedule',
      'meals_included', 'min_days_before_checkin', 'same_day_cutoff_hour',
      'min_stay', 'max_stay', 'pricing_mode', 'applied_listings', 'is_active',
      'pricing_modifier_percent', 'pricing_modifier_type', 'derived_from_plan_id',
      'valid_weekdays'
    ];

    const setClauses: string[] = ["updated_at = CURRENT_TIMESTAMP"];
    const values: any[] = [];

    for (const key of allowed) {
      if (key in body) {
        setClauses.push(`${key} = ?`);
        let val = body[key];
        // Normalise legacy 'derived' → 'dependent' (DB CHECK constraint)
        if (key === 'pricing_mode' && val === 'derived') val = 'dependent';
        values.push(jsonFields.includes(key) && typeof val !== 'string'
          ? JSON.stringify(val)
          : val ?? null);
      }
    }

    if (setClauses.length === 1) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    values.push(planId, id);
    await sql.run(`UPDATE site_rate_plans SET ${setClauses.join(', ')} WHERE id = ? AND site_id = ?`, values);

    const updated = await sql.row<any>('SELECT * FROM site_rate_plans WHERE id = ? AND site_id = ?', [planId, id]);
    try { updated.payment_schedule = JSON.parse(updated.payment_schedule); } catch { /* */ }
    try { updated.meals_included = JSON.parse(updated.meals_included); } catch { /* */ }
    try { updated.applied_listings = JSON.parse(updated.applied_listings); } catch { /* */ }
    try { updated.valid_weekdays = updated.valid_weekdays ? JSON.parse(updated.valid_weekdays) : null; } catch { /* */ }

    return NextResponse.json({ plan: updated });
    });
  } catch (error: any) {
    return serverError('app/api/booking-sites/[id]/rate-plans/[planId] PATCH', error, 'Failed to update rate plan');
  }
}

// DELETE /api/booking-sites/[id]/rate-plans/[planId]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> }
) {
  try {
    const { id, planId } = await params;

    return await withOwnedSite(req.headers.get('cookie'), id, async () => {
    const sql = getSql();

    const plan = await sql.row<any>('SELECT id FROM site_rate_plans WHERE id = ? AND site_id = ?', [planId, id]);
    if (!plan) return NextResponse.json({ error: 'Rate plan not found' }, { status: 404 });

    await sql.run("UPDATE site_rate_plans SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND site_id = ?", [planId, id]);
    return NextResponse.json({ success: true });
    });
  } catch (error: any) {
    return serverError('app/api/booking-sites/[id]/rate-plans/[planId] DELETE', error, 'Failed to delete rate plan');
  }
}

export { PATCH as PUT };
