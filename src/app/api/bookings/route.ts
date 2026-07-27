import { store } from '@/lib/store';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenantId');
  const propertyId = searchParams.get('propertyId') || undefined;

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  const bookings = store.getBookings(tenantId, propertyId);
  return NextResponse.json({ bookings });
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    const body = await request.json();
    const { propertyId, roomId, guestName, checkIn, checkOut, totalPrice, status, guestsCount } =
      body;

    if (!propertyId || !roomId || !guestName || !checkIn || !checkOut) {
      return NextResponse.json(
        { error: 'propertyId, roomId, guestName, checkIn, and checkOut are required' },
        { status: 400 },
      );
    }

    const booking = store.createBooking(tenantId, {
      propertyId,
      roomId,
      guestName,
      checkIn,
      checkOut,
      totalPrice: Number.parseFloat(totalPrice) || 0,
      status: status || 'confirmed',
      guestsCount: Number.parseInt(guestsCount, 10) || 2,
    });

    return NextResponse.json({ booking }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
  }
}
