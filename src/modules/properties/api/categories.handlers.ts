import { NextRequest, NextResponse } from 'next/server';
import * as categoriesRepo from '../data/categories.repo';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { requirePropertyId } from '@core/auth/tenant-context';

/**
 * The organization comes from the session, never from the request. A null from
 * the repository means "not yours, or not there" and answers 404, so ids cannot
 * be probed for existence.
 */

type IdParams = { params: Promise<{ id: string }> };

export const listCategories = withActor(async (_req, _ctx, actor: Actor) => {
  try {
    return NextResponse.json(await categoriesRepo.listCategories(actor.organizationId));
  } catch (error) {
    console.error('GET /api/categories error:', error);
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
  }
});

export const createCategory = withPermission('manage_properties', async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const body = await request.json();
    const { name, type, description, sort_order, icon, color } = body;

    if (!name || !type) {
      return NextResponse.json({ error: 'name and type are required' }, { status: 400 });
    }

    // The property is the server's to resolve — same reason as in
    // unit-types.handlers.ts. Requiring it from the caller means the admin
    // screen has to know an id, and the only way it ever knew one was a
    // literal from the first customer's seed data.
    let property_id: string;
    try {
      property_id = await requirePropertyId(body.property_id);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Property not found' }, { status: 400 });
    }

    if (!categoriesRepo.validateCategoryType(type)) {
      return NextResponse.json({ error: 'type must be glamping, resort, or camping' }, { status: 400 });
    }

    const created = await categoriesRepo.createCategory(actor.organizationId, {
      property_id, name, type, description, sort_order, icon, color,
    });
    if (!created) return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('POST /api/categories error:', error);
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 });
  }
});

export const updateCategory = withPermission('manage_properties', async (request: NextRequest, context: IdParams, actor: Actor) => {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const updated = await categoriesRepo.updateCategory(actor.organizationId, id, body);
    if (!updated) return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/categories/:id error:', error);
    return NextResponse.json({ error: 'Failed to update category' }, { status: 500 });
  }
});

export const deleteCategory = withPermission('manage_properties', async (_request, context: IdParams, actor: Actor) => {
  try {
    const { id } = await context.params;
    const result = await categoriesRepo.deleteCategory(actor.organizationId, id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.error === 'Not found' ? 404 : 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/categories/:id error:', error);
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 });
  }
});
