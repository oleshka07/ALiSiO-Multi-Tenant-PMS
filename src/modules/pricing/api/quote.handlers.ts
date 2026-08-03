/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { calculateQuote } from '../data/quote.repo';

export async function getQuote(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { unitTypeId, checkIn, checkOut, adults = 2, children = 0 } = body;

    if (!unitTypeId || !checkIn || !checkOut) {
      return NextResponse.json({ error: 'unitTypeId, checkIn, checkOut required' }, { status: 400 });
    }

    const start = new Date(checkIn);
    const end = new Date(checkOut);
    if (end <= start) return NextResponse.json({ error: 'checkOut must be after checkIn' }, { status: 400 });

    return NextResponse.json(await calculateQuote(unitTypeId, checkIn, checkOut, adults, children));
  } catch (error: any) {
    console.error('POST /api/pricing/quote error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to calculate quote' }, { status: 500 });
  }
}
