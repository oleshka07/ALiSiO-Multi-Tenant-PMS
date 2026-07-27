import { NextRequest, NextResponse } from 'next/server';
import * as buildingsRepo from '../data/buildings.repo';

export async function listBuildings(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const rows = buildingsRepo.listBuildings({
      property_id: searchParams.get('property_id') || undefined,
    });
    return NextResponse.json(rows);
  } catch (error) {
    console.error('GET /api/buildings error:', error);
    return NextResponse.json({ error: 'Failed to fetch buildings' }, { status: 500 });
  }
}

export async function createBuilding(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { category_id, property_id, name, code, description, sort_order } = body;

    if (!category_id || !property_id || !name || !code) {
      return NextResponse.json({ error: 'category_id, property_id, name, and code are required' }, { status: 400 });
    }

    const created = buildingsRepo.createBuilding({ category_id, property_id, name, code, description, sort_order });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('POST /api/buildings error:', error);
    return NextResponse.json({ error: 'Failed to create building' }, { status: 500 });
  }
}

type IdParams = { params: Promise<{ id: string }> };

export async function updateBuilding(request: NextRequest, context: IdParams): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const updated = buildingsRepo.updateBuilding(id, body);
    if (!updated) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/buildings/:id error:', error);
    return NextResponse.json({ error: 'Failed to update building' }, { status: 500 });
  }
}

export async function deleteBuilding(_request: NextRequest, context: IdParams): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const result = buildingsRepo.deleteBuilding(id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/buildings/:id error:', error);
    return NextResponse.json({ error: 'Failed to delete building' }, { status: 500 });
  }
}
