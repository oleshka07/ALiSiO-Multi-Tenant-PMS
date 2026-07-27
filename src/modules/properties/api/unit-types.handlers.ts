import { NextRequest, NextResponse } from 'next/server';
import * as unitTypesRepo from '../data/unit-types.repo';

export async function listUnitTypes(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const rows = unitTypesRepo.listUnitTypes({
      category: searchParams.get('category') || undefined,
    });
    return NextResponse.json(rows);
  } catch (error) {
    console.error('GET /api/unit-types error:', error);
    return NextResponse.json({ error: 'Failed to fetch unit types' }, { status: 500 });
  }
}

export async function createUnitType(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { property_id, category_id, building_id, name, code, description, max_adults, max_children, max_occupancy, base_occupancy, beds_single, beds_double, beds_sofa, extra_bed_available, sort_order } = body;

    if (!property_id || !category_id || !name || !code) {
      return NextResponse.json({ error: 'property_id, category_id, name, and code are required' }, { status: 400 });
    }

    const created = unitTypesRepo.createUnitType({ property_id, category_id, building_id, name, code, description, max_adults, max_children, max_occupancy, base_occupancy, beds_single, beds_double, beds_sofa, extra_bed_available, sort_order });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('POST /api/unit-types error:', error);
    return NextResponse.json({ error: 'Failed to create unit type' }, { status: 500 });
  }
}

type IdParams = { params: Promise<{ id: string }> };

export async function updateUnitType(request: NextRequest, context: IdParams): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const updated = unitTypesRepo.updateUnitType(id, body);
    if (!updated) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/unit-types/:id error:', error);
    return NextResponse.json({ error: 'Failed to update unit type' }, { status: 500 });
  }
}

export async function deleteUnitType(_request: NextRequest, context: IdParams): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const result = unitTypesRepo.deleteUnitType(id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/unit-types/:id error:', error);
    return NextResponse.json({ error: 'Failed to delete unit type' }, { status: 500 });
  }
}
