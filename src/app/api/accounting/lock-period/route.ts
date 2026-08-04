/**
 * Monthly invoice-period locking (per series).
 *
 * GET  /api/accounting/lock-period            → list all periods + their status
 * POST /api/accounting/lock-period            → { series, month, action:'lock'|'unlock' }
 *
 * Locking freezes invoice numbers in that (series, month): they can no longer be
 * deleted or renumbered — corrections go through a storno (credit note).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@core/db';
import { requireOwner } from '@core/security/route-guard';
import { lockPeriod, unlockPeriod, seriesForChannel } from '@/modules/finance/domain/invoice-numbering';
import type { Actor } from '@core/auth/session';
import { getSql } from '@core/db/async';

export const GET = requireOwner(async (_request, _ctx, actor: Actor): Promise<NextResponse> => {
  const db = getDb();
    const sql = getSql();
  const periods = db.prepare(
    'SELECT series, month, status, locked_at FROM invoice_periods WHERE organization_id = ? ORDER BY month DESC, series'
  ).all(actor.organizationId);
  // Also surface open (series, month) combos that have invoices but no explicit row yet.
  const derived = db.prepare(`
    SELECT series, substr(COALESCE(period, issued_at),1,7) AS month, COUNT(*) AS invoices
    FROM invoices WHERE organization_id = ? AND status = 'issued'
    GROUP BY series, month ORDER BY month DESC, series
  `).all(actor.organizationId);
  return NextResponse.json({ periods, derived });
});

export const POST = requireOwner(async (request: NextRequest, _ctx, actor: Actor): Promise<NextResponse> => {
  try {
    const { series, month, action, channel } = await request.json();
    const resolvedSeries = (series || seriesForChannel(channel).series) as string;
    if (!resolvedSeries || !/^\d{4}-\d{2}$/.test(month || '')) {
      return NextResponse.json({ error: 'series and month=YYYY-MM are required' }, { status: 400 });
    }
    const db = getDb();
    const sql = getSql();
    if (action === 'unlock') {
      await unlockPeriod(sql, actor.organizationId, resolvedSeries, month);
      return NextResponse.json({ ok: true, series: resolvedSeries, month, status: 'open' });
    }
    await lockPeriod(sql, actor.organizationId, resolvedSeries, month);
    return NextResponse.json({ ok: true, series: resolvedSeries, month, status: 'locked' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});
