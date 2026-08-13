import { NextRequest, NextResponse } from 'next/server';
import * as unitsRepo from '../data/units.repo';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { requirePropertyId, propertyErrorStatus } from '@core/auth/tenant-context';

/**
 * The organization comes from the session, never from the request. A null or an
 * empty result from the repository means "not yours, or not there" and answers
 * 404, so ids cannot be probed for existence.
 */

type IdParams = { params: Promise<{ id: string }> };

export const listUnits = withActor(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const { searchParams } = new URL(request.url);
    const rows = await unitsRepo.listUnits(actor.organizationId, {
      category: searchParams.get('category') || undefined,
      unitType: searchParams.get('unitType') || undefined,
      includePool: searchParams.get('include_pool') === '1',
    });
    return NextResponse.json(rows);
  } catch (error) {
    console.error('GET /api/units error:', error);
    return NextResponse.json({ error: 'Failed to fetch units' }, { status: 500 });
  }
});

export const createUnit = withPermission('manage_properties', async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const body = await request.json();

    // Which property, decided here rather than by the caller — see the note in
    // unit-types.handlers.ts. The screen used to send one customer's seed id.
    let property_id: string;
    try {
      property_id = await requirePropertyId(body.property_id);
    } catch (e) {
      // 404 when the property is not this tenant's, 400 when the request
      // itself cannot be answered — see propertyErrorStatus.
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Property not found' },
        { status: propertyErrorStatus(e) },
      );
    }

    if (body.bulk) {
      const { category_id, building_id, unit_type_id, prefix, from, to, beds, zone } = body;

      // `prefix == null`, not `!prefix`. An empty prefix is a normal answer:
      // a hotel whose rooms are 105, 106, 201 has no prefix at all, and the
      // falsy test refused exactly that hotel while accepting every other.
      if (!category_id || !unit_type_id || prefix == null || from === undefined || to === undefined) {
        return NextResponse.json({ error: 'For bulk: category_id, unit_type_id, prefix, from, to required' }, { status: 400 });
      }

      if (from > to || to - from > 200) {
        return NextResponse.json({ error: 'Invalid range (max 200 units at once)' }, { status: 400 });
      }

      const created = await unitsRepo.bulkCreateUnits(actor.organizationId, {
        property_id, category_id, building_id, unit_type_id, prefix, from, to, beds, zone,
      });
      // null means the referenced ids are not this tenant's — unchecked, this
      // call wrote up to 200 rooms into someone else's property.
      if (created === null) {
        return NextResponse.json({ error: 'Property, category, unit type or building not found' }, { status: 404 });
      }
      // An empty list is a different answer: every number in the range is
      // already a room here. Saying "not found" to that sends the operator
      // looking for a missing category that is sitting right in front of them.
      if (created.length === 0) {
        return NextResponse.json(
          { error: 'Every room number in this range already exists', created: 0, items: [] },
          { status: 409 },
        );
      }
      return NextResponse.json({ created: created.length, items: created }, { status: 201 });
    }

    const { unit_type_id, category_id, building_id, name, code, floor, zone, beds, notes, sort_order } = body;

    if (!unit_type_id || !category_id || !name || !code) {
      return NextResponse.json({ error: 'unit_type_id, category_id, name and code are required' }, { status: 400 });
    }

    const unit = await unitsRepo.createUnit(actor.organizationId, {
      unit_type_id, property_id, category_id, building_id, name, code, floor, zone, beds, notes, sort_order,
    });
    if (!unit) return NextResponse.json({ error: 'Property, category, unit type or building not found' }, { status: 404 });
    return NextResponse.json(unit, { status: 201 });
  } catch (error: unknown) {
    console.error('POST /api/units error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to create unit';
    if (msg.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Unit with this code already exists in this property' }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});

export const updateUnit = withPermission('manage_properties', async (request: NextRequest, context: IdParams, actor: Actor) => {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const updated = await unitsRepo.updateUnit(actor.organizationId, id, body);
    if (!updated) return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/units/:id error:', error);
    return NextResponse.json({ error: 'Failed to update unit' }, { status: 500 });
  }
});

export const deleteUnit = withPermission('manage_properties', async (_request, context: IdParams, actor: Actor) => {
  try {
    const { id } = await context.params;
    const result = await unitsRepo.deleteUnit(actor.organizationId, id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.error === 'Not found' ? 404 : 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/units/:id error:', error);
    return NextResponse.json({ error: 'Failed to delete unit' }, { status: 500 });
  }
});
