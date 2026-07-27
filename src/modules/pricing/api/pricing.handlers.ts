/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getPriceMonth, upsertPrices } from '../data/price-calendar.repo';

export async function getPricing(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const unitTypeId = searchParams.get('unitTypeId');
    const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1));
    const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()));

    if (!unitTypeId) return NextResponse.json({ error: 'unitTypeId is required' }, { status: 400 });

    return NextResponse.json(getPriceMonth(unitTypeId, month, year));
  } catch (error: any) {
    console.error('GET /api/pricing error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to fetch pricing' }, { status: 500 });
  }
}

export async function updatePricing(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { unitTypeId, prices } = body;

    if (!unitTypeId || !Array.isArray(prices) || prices.length === 0) {
      return NextResponse.json({ error: 'unitTypeId and prices array required' }, { status: 400 });
    }

    const updated = upsertPrices(unitTypeId, prices);

    // Trigger ARI sync — non-critical, contained in try/catch.
    // Will be replaced with eventBus.emit('pricing.updated') when channels module is migrated.
    try {
      const { enqueueForAllConnections } = await import('@/lib/channels/sync-queue');
      const dates = prices.map((p: any) => p.date).sort();
      if (dates.length > 0) {
        enqueueForAllConnections({ syncType: 'full', unitTypeId, dateFrom: dates[0], dateTo: dates[dates.length - 1], priority: 3 });
      }
    } catch (syncError: any) {
      console.warn('[Pricing] ARI sync enqueue failed:', syncError?.message);
    }

    return NextResponse.json({ success: true, updated });
  } catch (error: any) {
    console.error('PUT /api/pricing error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to update pricing' }, { status: 500 });
  }
}
