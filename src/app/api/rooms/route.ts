import { store } from '@/lib/store';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenantId');
  const propertyId = searchParams.get('propertyId') || undefined;

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  const rooms = store.getRooms(tenantId, propertyId);
  return NextResponse.json({ rooms });
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    const body = await request.json();
    const { propertyId, roomTypeId, roomNumber, floor, status } = body;

    if (!propertyId || !roomTypeId || !roomNumber) {
      return NextResponse.json(
        { error: 'propertyId, roomTypeId, and roomNumber are required' },
        { status: 400 },
      );
    }

    const room = store.createRoom(tenantId, {
      propertyId,
      roomTypeId,
      roomNumber,
      floor: floor || '1',
      status: status || 'available',
    });

    return NextResponse.json({ room }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 });
  }
}
