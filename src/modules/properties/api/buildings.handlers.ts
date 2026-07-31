import { NextRequest, NextResponse } from 'next/server';
import * as buildingsRepo from '../data/buildings.repo';
import { withActor, withPermission, type Actor } from '@core/auth/session';

/**
 * The organization comes from the session, never from the request. A null from
 * the repository means "not yours, or not there" and answers 404, so ids cannot
 * be probed for existence.
 */

type IdParams = { params: Promise<{ id: string }> };

export const listBuildings = withActor(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const { searchParams } = new URL(request.url);
    const rows = buildingsRepo.listBuildings(actor.organizationId, {
      property_id: searchParams.get('property_id') || undefined,
    });
    return NextResponse.json(rows);
  } catch (error) {
    console.error('GET /api/buildings error:', error);
    return NextResponse.json({ error: 'Failed to fetch buildings' }, { status: 500 });
  }
});

export const createBuilding = withPermission('manage_properties', async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const body = await request.json();
    const { category_id, property_id, name, code, description, sort_order } = body;

    if (!category_id || !property_id || !name || !code) {
      return NextResponse.json({ error: 'category_id, property_id, name, and code are required' }, { status: 400 });
    }

    const created = buildingsRepo.createBuilding(actor.organizationId, {
      category_id, property_id, name, code, description, sort_order,
    });
    if (!created) return NextResponse.json({ error: 'Property or category not found' }, { status: 404 });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('POST /api/buildings error:', error);
    return NextResponse.json({ error: 'Failed to create building' }, { status: 500 });
  }
});

export const updateBuilding = withPermission('manage_properties', async (request: NextRequest, context: IdParams, actor: Actor) => {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const updated = buildingsRepo.updateBuilding(actor.organizationId, id, body);
    if (!updated) return NextResponse.json({ error: 'Building not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/buildings/:id error:', error);
    return NextResponse.json({ error: 'Failed to update building' }, { status: 500 });
  }
});

export const deleteBuilding = withPermission('manage_properties', async (_request, context: IdParams, actor: Actor) => {
  try {
    const { id } = await context.params;
    const result = buildingsRepo.deleteBuilding(actor.organizationId, id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.error === 'Not found' ? 404 : 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/buildings/:id error:', error);
    return NextResponse.json({ error: 'Failed to delete building' }, { status: 500 });
  }
});
