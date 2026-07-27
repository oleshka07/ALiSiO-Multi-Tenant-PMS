import { store } from '@/lib/store';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenantId');

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  const properties = store.getProperties(tenantId);
  return NextResponse.json({ properties });
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    const body = await request.json();
    const { name, type, address, city, country, currency } = body;

    if (!name || !type) {
      return NextResponse.json({ error: 'Name and type are required' }, { status: 400 });
    }

    const property = store.createProperty(tenantId, {
      name,
      type: type || 'glamping',
      address: address || '',
      city: city || 'Київ',
      country: country || 'Україна',
      currency: currency || 'UAH',
    });

    return NextResponse.json({ property }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create property' }, { status: 500 });
  }
}
