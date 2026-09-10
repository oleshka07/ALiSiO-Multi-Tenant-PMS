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
import { requireFinanceAccess } from '@core/security/route-guard';
import { lockPeriod, unlockPeriod, seriesForChannel } from '@invoicing';
import {
  requirePropertyScope, requestedPropertyParam, scopedPropertyId, propertyOrSharedFilter,
} from '@core/property-scope';
import type { Actor } from '@core/auth/session';
import { getSql } from '@core/db/async';
import { serverError } from '@core/http/errors';

export const GET = requireFinanceAccess(async (request: NextRequest, _ctx, actor: Actor): Promise<NextResponse> => {
  const sql = getSql();
  // Місяці ОБРАНОГО обʼєкта плюс спільні (INC-038, Д54): два будинки під одним
  // рахунком ведуть дві книги, і закритий місяць одного не є станом другого.
  // `propertyOrSharedFilter`, бо `invoice_periods.property_id` нульовий —
  // рахунковий місяць має бути видимим з обох будинків (Д51).
  const axis = propertyOrSharedFilter(
    await requirePropertyScope(requestedPropertyParam(request.url)), '');
  const periods = await sql.rows(
    `SELECT series, month, status, locked_at, property_id FROM invoice_periods
      WHERE organization_id = ? AND ${axis.sql} ORDER BY month DESC, series`,
    [actor.organizationId, ...axis.params],
  );
  // Also surface open (series, month) combos that have invoices but no explicit row yet.
  const derived = await sql.rows(`
    SELECT series, substr(COALESCE(period, CAST(issued_at AS TEXT)),1,7) AS month, COUNT(*) AS invoices
    FROM invoices WHERE organization_id = ? AND status = 'issued'
    GROUP BY series, month ORDER BY month DESC, series
  `, [actor.organizationId]);
  return NextResponse.json({ periods, derived });
});

export const POST = requireFinanceAccess(async (request: NextRequest, _ctx, actor: Actor): Promise<NextResponse> => {
  try {
    const { series, month, action, channel } = await request.json();
    const resolvedSeries = (series || seriesForChannel(channel).series) as string;
    if (!resolvedSeries || !/^\d{4}-\d{2}$/.test(month || '')) {
      return NextResponse.json({ error: 'series and month=YYYY-MM are required' }, { status: 400 });
    }
    const sql = getSql();
    // Який будинок закривають — каже перемикач у шапці. «Усі обʼєкти» означає
    // рахунковий місяць, а не місяць першого будинку.
    const property = scopedPropertyId(
      await requirePropertyScope(requestedPropertyParam(request.url)));
    if (action === 'unlock') {
      await unlockPeriod(sql, actor.organizationId, property, resolvedSeries, month);
      return NextResponse.json({ ok: true, series: resolvedSeries, month, status: 'open' });
    }
    await lockPeriod(sql, actor.organizationId, property, resolvedSeries, month);
    return NextResponse.json({ ok: true, series: resolvedSeries, month, status: 'locked' });
  } catch (e: unknown) {
    // Текст винятку — у лог, клієнту речення (інваріант 6, Ц43). Тут раніше
    // їхало повідомлення бази: список дозволених значень CHECK і назва колонки,
    // зі статусом 500 і без жодного рядка в лозі.
    return serverError('app/api/accounting/lock-period', e, 'Failed to lock the period');
  }
});
