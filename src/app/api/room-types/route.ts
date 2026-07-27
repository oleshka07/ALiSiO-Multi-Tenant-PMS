import { store } from '@/lib/store';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenantId');
  const propertyId = searchParams.get('propertyId') || undefined;

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  const roomTypes = store.getRoomTypes(tenantId, propertyId);
  return NextResponse.json({ roomTypes });
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    const body = await request.json();
    const { propertyId, name, baseOccupancy, maxOccupancy, basePrice, description } = body;

    if (!propertyId || !name) {
      return NextResponse.json({ error: 'propertyId and name are required' }, { status: 400 });
    }

    const roomType = store.createRoomType(tenantId, {
      propertyId,
      name,
      baseOccupancy: baseOccupancy || 2,
      maxOccupancy: maxOccupancy || 2,
      basePrice: basePrice || 0,
      description: description || '',
    });

    return NextResponse.json({ roomType }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create room type' }, { status: 500 });
  }
}
