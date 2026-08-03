import { NextRequest, NextResponse } from 'next/server';
import * as unitTypesRepo from '../data/unit-types.repo';
import { withActor, withPermission, type Actor } from '@core/auth/session';

/**
 * The organization comes from the session, never from the request. A null from
 * the repository means "not yours, or not there" and answers 404, so ids cannot
 * be probed for existence.
 */

type IdParams = { params: Promise<{ id: string }> };

export const listUnitTypes = withActor(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const { searchParams } = new URL(request.url);
    const rows = await unitTypesRepo.listUnitTypes(actor.organizationId, {
      category: searchParams.get('category') || undefined,
    });
    return NextResponse.json(rows);
  } catch (error) {
    console.error('GET /api/unit-types error:', error);
    return NextResponse.json({ error: 'Failed to fetch unit types' }, { status: 500 });
  }
});

export const createUnitType = withPermission('manage_properties', async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const body = await request.json();
    const { property_id, category_id, building_id, name, code, description, max_adults, max_children, max_occupancy, base_occupancy, beds_single, beds_double, beds_sofa, extra_bed_available, sort_order } = body;

    if (!property_id || !category_id || !name || !code) {
      return NextResponse.json({ error: 'property_id, category_id, name, and code are required' }, { status: 400 });
    }

    const created = await unitTypesRepo.createUnitType(actor.organizationId, {
      property_id, category_id, building_id, name, code, description,
      max_adults, max_children, max_occupancy, base_occupancy,
      beds_single, beds_double, beds_sofa, extra_bed_available, sort_order,
    });
    if (!created) return NextResponse.json({ error: 'Property, category or building not found' }, { status: 404 });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('POST /api/unit-types error:', error);
    return NextResponse.json({ error: 'Failed to create unit type' }, { status: 500 });
  }
});

export const updateUnitType = withPermission('manage_properties', async (request: NextRequest, context: IdParams, actor: Actor) => {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const updated = await unitTypesRepo.updateUnitType(actor.organizationId, id, body);
    if (!updated) return NextResponse.json({ error: 'Unit type not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/unit-types/:id error:', error);
    return NextResponse.json({ error: 'Failed to update unit type' }, { status: 500 });
  }
});

export const deleteUnitType = withPermission('manage_properties', async (_request, context: IdParams, actor: Actor) => {
  try {
    const { id } = await context.params;
    const result = await unitTypesRepo.deleteUnitType(actor.organizationId, id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.error === 'Not found' ? 404 : 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/unit-types/:id error:', error);
    return NextResponse.json({ error: 'Failed to delete unit type' }, { status: 500 });
  }
});
