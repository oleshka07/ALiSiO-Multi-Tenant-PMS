/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { withActor, type Actor, withPermission } from '@core/auth/session';
import { getBulkPrices, bulkUpdatePrices } from '../data/price-calendar.repo';
import { ownedUnitType } from '../data/owned.repo';

export const getBulkPricing = withActor(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!startDate || !endDate) return NextResponse.json({ error: 'startDate and endDate required' }, { status: 400 });

    return NextResponse.json(await getBulkPrices(actor.organizationId, startDate, endDate));
  } catch (error: any) {
    console.error('GET /api/pricing/bulk error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to fetch pricing' }, { status: 500 });
  }
})

export const updateBulkPricing = withPermission('manage_pricing', async (request: NextRequest, _ctx, actor: Actor): Promise<NextResponse> => {
  try {
    const body = await request.json();
    const { unitTypeId, dateFrom, dateTo, applyTo = 'all' } = body;

    if (!unitTypeId || !dateFrom || !dateTo) {
      return NextResponse.json({ error: 'unitTypeId, dateFrom, dateTo required' }, { status: 400 });
    }

    // Same as the day calendar: the id is handed to us, so ownership is asked
    // in SQL rather than left to a policy that only one of the two engines has.
    if (!await ownedUnitType(unitTypeId, actor.organizationId)) {
      return NextResponse.json({ error: 'Unit type not found' }, { status: 404 });
    }

    let updated: number;
    try {
      updated = await bulkUpdatePrices({ unitTypeId, dateFrom, dateTo, applyTo, ...body, ratePlanId: typeof body.ratePlanId === 'string' && body.ratePlanId ? body.ratePlanId : undefined });
    } catch (e) {
      if (e instanceof Error && /rate plan not found/i.test(e.message)) return NextResponse.json({ error: 'Rate plan not found' }, { status: 404 });
      // Нуль і відʼємне — не ціна (2.0): названа відмова, екран її перекладає.
      if (e instanceof Error && e.message === 'price_not_positive') return NextResponse.json({ error: 'price_not_positive' }, { status: 400 });
      throw e;
    }
    return NextResponse.json({ success: true, updated });
  } catch (error: any) {
    console.error('PUT /api/pricing/bulk error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to bulk update pricing' }, { status: 500 });
  }
});
