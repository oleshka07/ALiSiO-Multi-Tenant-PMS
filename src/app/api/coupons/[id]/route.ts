import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withPermission, type Actor } from '@core/auth/session';

/**
 * A coupon, by id. Both handlers wrote `WHERE id = ?` over a table that
 * carries organization_id — so on SQLite anyone with `manage_sites` at any
 * hotel could rewrite or delete another hotel's discount codes. The
 * neighbouring gift-cards routes were already written correctly, which is
 * what makes this a slip rather than a design.
 */
import { serverError } from '@core/http/errors';

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = withPermission('manage_sites', async (req: NextRequest, ctx: Ctx, actor: Actor) => {
  try {
    const { id } = await ctx.params;
    const sql = getSql();

    await sql.run('DELETE FROM coupons WHERE id = ? AND organization_id = ?', [id, actor.organizationId]);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
});

export const PUT = withPermission('manage_sites', async (req: NextRequest, ctx: Ctx, actor: Actor) => {
  try {
    const { id } = await ctx.params;
    const sql = getSql();
    const body = await req.json();
    const allowed = [
      'code', 'discount_type', 'offer_amount', 'valid_from', 'valid_until',
      'min_nights', 'max_nights', 'redemption_limit', 'allowed_days', 'applies_to',
      'applied_listings', 'applicable_services'
    ];
    
    const sets: string[] = [];
    const vals: unknown[] = [];
    
    for (const k of allowed) {
      if (k in body) {
        sets.push(`${k} = ?`);
        if (k === 'allowed_days' || k === 'applied_listings' || k === 'applicable_services') {
          vals.push(body[k] ? JSON.stringify(body[k]) : null);
        } else if (k === 'max_uses' || k === 'redemption_limit') {
          // Keep max_uses in sync with redemption_limit for coupons logic
          vals.push(body[k] ? Number(body[k]) : null);
          if (k === 'redemption_limit') {
             sets.push('max_uses = ?');
             vals.push(body[k] ? Number(body[k]) : null);
          }
        } else if (k === 'code') {
          vals.push(String(body[k]).toUpperCase().trim());
        } else {
          vals.push(body[k] === '' ? null : body[k]);
        }
      }
    }
    
    if (sets.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    
    vals.push(id);
    vals.push(actor.organizationId);
    await sql.run(`UPDATE coupons SET ${sets.join(', ')} WHERE id = ? AND organization_id = ?`, vals);

    const updated = await sql.row('SELECT * FROM coupons WHERE id = ? AND organization_id = ?', [id, actor.organizationId]);
    return NextResponse.json({ code: updated });
  } catch (err: unknown) {
    const e = err as Error;
    if (e?.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Промокод з таким кодом вже існує' }, { status: 409 });
    }
    return serverError('app/api/coupons/[id] PUT', e, 'Error');
  }
});
