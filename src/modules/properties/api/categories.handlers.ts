import { NextRequest, NextResponse } from 'next/server';
import * as categoriesRepo from '../data/categories.repo';

export async function listCategories(): Promise<NextResponse> {
  try {
    const rows = categoriesRepo.listCategories();
    return NextResponse.json(rows);
  } catch (error) {
    console.error('GET /api/categories error:', error);
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
  }
}

export async function createCategory(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { property_id, name, type, description, sort_order, icon, color } = body;

    if (!property_id || !name || !type) {
      return NextResponse.json({ error: 'property_id, name, and type are required' }, { status: 400 });
    }

    if (!categoriesRepo.validateCategoryType(type)) {
      return NextResponse.json({ error: 'type must be glamping, resort, or camping' }, { status: 400 });
    }

    const created = categoriesRepo.createCategory({ property_id, name, type, description, sort_order, icon, color });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('POST /api/categories error:', error);
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 });
  }
}

type IdParams = { params: Promise<{ id: string }> };

export async function updateCategory(request: NextRequest, context: IdParams): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const updated = categoriesRepo.updateCategory(id, body);
    if (!updated) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/categories/:id error:', error);
    return NextResponse.json({ error: 'Failed to update category' }, { status: 500 });
  }
}

export async function deleteCategory(_request: NextRequest, context: IdParams): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const result = categoriesRepo.deleteCategory(id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/categories/:id error:', error);
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 });
  }
}
