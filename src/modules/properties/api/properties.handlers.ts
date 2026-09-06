import { NextRequest, NextResponse } from 'next/server';
import * as propertiesRepo from '../data/properties.repo';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { hasPermission } from '@core/auth/permissions';

/**
 * Each handler is wrapped so it cannot run without an identity, and the
 * organization comes from the session rather than from the request. None of
 * these resolved a caller before: the middleware only checks that a session_id
 * cookie exists, so DELETE /api/properties/:id deleted any tenant's property
 * and cascaded through its units, reservations and guests.
 *
 * A wrong-tenant id answers 404 rather than 403, so probing ids cannot be used
 * to learn which of them exist.
 */

type IdParams = { params: Promise<{ id: string }> };

export const listProperties = withActor(async (_req, _ctx, actor: Actor) => {
  try {
    return NextResponse.json(await propertiesRepo.listProperties(actor.organizationId));
  } catch (error) {
    console.error('GET /api/properties error:', error);
    return NextResponse.json({ error: 'Failed to fetch properties' }, { status: 500 });
  }
});

export const createProperty = withPermission('manage_properties', async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const body = await request.json();
    const { name, slug, address, city, country, phone, email, check_in_time, check_out_time } = body;

    if (!name || !slug) {
      return NextResponse.json({ error: 'Name and slug are required' }, { status: 400 });
    }

    const created = await propertiesRepo.createProperty(actor.organizationId, {
      name, slug, address, city, country, phone, email, check_in_time, check_out_time,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error: unknown) {
    console.error('POST /api/properties error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to create property';
    if (msg.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Property with this slug already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});

export const getProperty = withActor(async (_request, context: IdParams, actor: Actor) => {
  try {
    const { id } = await context.params;
    // Секрети номера — лише під manage_properties, як і в `/api/units`
    // (О8, рецензія 6 п. 3.1). Маршрут лишається під `withActor`: картку
    // обʼєкта читають і ролі без цього права, і 403 на всю картку зламав би
    // їм роботу заради двох полів, яких вони не показують.
    const result = await propertiesRepo.getPropertyById(actor.organizationId, id, {
      secrets: hasPermission(actor.user.permissions, 'manage_properties'),
    });
    if (!result) return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    console.error('GET /api/properties/:id error:', error);
    return NextResponse.json({ error: 'Failed to fetch property' }, { status: 500 });
  }
});

export const updateProperty = withPermission('manage_properties', async (request: NextRequest, context: IdParams, actor: Actor) => {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const updated = await propertiesRepo.updateProperty(actor.organizationId, id, body);
    if (!updated) return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/properties/:id error:', error);
    return NextResponse.json({ error: 'Failed to update property' }, { status: 500 });
  }
});

export const deleteProperty = withPermission('manage_properties', async (_request, context: IdParams, actor: Actor) => {
  try {
    const { id } = await context.params;
    const result = await propertiesRepo.deleteProperty(actor.organizationId, id);
    if (!result.ok) {
      const status = result.error === 'Not found' ? 404 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/properties/:id error:', error);
    return NextResponse.json({ error: 'Failed to delete property' }, { status: 500 });
  }
});
