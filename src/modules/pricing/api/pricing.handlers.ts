/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getPriceMonth, upsertPrices } from '../data/price-calendar.repo';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { ownedUnitType } from '../data/owned.repo';

export const getPricing = withActor(async (request: NextRequest, _ctx, actor: Actor): Promise<NextResponse> => {
  try {
    const { searchParams } = new URL(request.url);
    const unitTypeId = searchParams.get('unitTypeId');
    const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1));
    const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()));

    if (!unitTypeId) return NextResponse.json({ error: 'unitTypeId is required' }, { status: 400 });

    // price_calendar is keyed by unit type alone, and the id comes from the
    // query string — so without this a logged-in user of any hotel could read
    // and rewrite another hotel's rates.
    if (!await ownedUnitType(unitTypeId, actor.organizationId)) {
      return NextResponse.json({ error: 'Unit type not found' }, { status: 404 });
    }

    return NextResponse.json(await getPriceMonth(unitTypeId, month, year));
  } catch (error: any) {
    console.error('GET /api/pricing error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to fetch pricing' }, { status: 500 });
  }
});

export const updatePricing = withPermission('manage_pricing', async (request: NextRequest, _ctx, actor: Actor): Promise<NextResponse> => {
  try {
    const body = await request.json();
    const { unitTypeId, prices } = body;

    if (!unitTypeId || !Array.isArray(prices) || prices.length === 0) {
      return NextResponse.json({ error: 'unitTypeId and prices array required' }, { status: 400 });
    }

    if (!await ownedUnitType(unitTypeId, actor.organizationId)) {
      return NextResponse.json({ error: 'Unit type not found' }, { status: 404 });
    }

    const updated = await upsertPrices(unitTypeId, prices);

    // A price change used to enqueue an ARI push here, wrapped in a try/catch
    // that swallowed the error — which is how nobody noticed the queue was
    // never drained. Both the queue and the Connectivity API it fed are gone.
    // When a channel with its own API arrives, it subscribes to a
    // `pricing.updated` event; it does not get a hidden call inside this
    // handler.

    return NextResponse.json({ success: true, updated });
  } catch (error: any) {
    console.error('PUT /api/pricing error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to update pricing' }, { status: 500 });
  }
});
