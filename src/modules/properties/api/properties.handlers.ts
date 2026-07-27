import { NextRequest, NextResponse } from 'next/server';
import * as propertiesRepo from '../data/properties.repo';

export async function listProperties(): Promise<NextResponse> {
  try {
    const rows = propertiesRepo.listProperties();
    return NextResponse.json(rows);
  } catch (error) {
    console.error('GET /api/properties error:', error);
    return NextResponse.json({ error: 'Failed to fetch properties' }, { status: 500 });
  }
}

export async function createProperty(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { name, slug, address, city, country, phone, email, check_in_time, check_out_time } = body;

    if (!name || !slug) {
      return NextResponse.json({ error: 'Name and slug are required' }, { status: 400 });
    }

    const created = propertiesRepo.createProperty({ name, slug, address, city, country, phone, email, check_in_time, check_out_time });
    return NextResponse.json(created, { status: 201 });
  } catch (error: unknown) {
    console.error('POST /api/properties error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to create property';
    if (msg.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Property with this slug already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

type IdParams = { params: Promise<{ id: string }> };

export async function getProperty(_request: NextRequest, context: IdParams): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const result = propertiesRepo.getPropertyById(id);
    if (!result) return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    console.error('GET /api/properties/:id error:', error);
    return NextResponse.json({ error: 'Failed to fetch property' }, { status: 500 });
  }
}

export async function updateProperty(request: NextRequest, context: IdParams): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const updated = propertiesRepo.updateProperty(id, body);
    if (!updated) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/properties/:id error:', error);
    return NextResponse.json({ error: 'Failed to update property' }, { status: 500 });
  }
}

export async function deleteProperty(_request: NextRequest, context: IdParams): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const result = propertiesRepo.deleteProperty(id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/properties/:id error:', error);
    return NextResponse.json({ error: 'Failed to delete property' }, { status: 500 });
  }
}
