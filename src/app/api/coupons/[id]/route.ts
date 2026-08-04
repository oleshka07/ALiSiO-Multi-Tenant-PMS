import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getSessionUser, getSessionIdFromCookies } from '@core/auth';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getSessionUser(getSessionIdFromCookies(req.headers.get('cookie')));
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await ctx.params;
    const sql = getSql();

    await sql.run('DELETE FROM coupons WHERE id = ?', [id]);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getSessionUser(getSessionIdFromCookies(req.headers.get('cookie')));
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
    await sql.run(`UPDATE coupons SET ${sets.join(', ')} WHERE id = ?`, vals);

    const updated = await sql.row('SELECT * FROM coupons WHERE id = ?', [id]);
    return NextResponse.json({ code: updated });
  } catch (err: unknown) {
    const e = err as Error;
    if (e?.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Промокод з таким кодом вже існує' }, { status: 409 });
    }
    return NextResponse.json({ error: e.message || 'Error' }, { status: 500 });
  }
}
