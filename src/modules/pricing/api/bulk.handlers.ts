/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getBulkPrices, bulkUpdatePrices } from '../data/price-calendar.repo';

export async function getBulkPricing(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!startDate || !endDate) return NextResponse.json({ error: 'startDate and endDate required' }, { status: 400 });

    return NextResponse.json(getBulkPrices(startDate, endDate));
  } catch (error: any) {
    console.error('GET /api/pricing/bulk error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to fetch pricing' }, { status: 500 });
  }
}

export async function updateBulkPricing(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { unitTypeId, dateFrom, dateTo, applyTo = 'all' } = body;

    if (!unitTypeId || !dateFrom || !dateTo) {
      return NextResponse.json({ error: 'unitTypeId, dateFrom, dateTo required' }, { status: 400 });
    }

    const updated = bulkUpdatePrices({ unitTypeId, dateFrom, dateTo, applyTo, ...body });
    return NextResponse.json({ success: true, updated });
  } catch (error: any) {
    console.error('PUT /api/pricing/bulk error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to bulk update pricing' }, { status: 500 });
  }
}
