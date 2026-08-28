import { NextRequest, NextResponse } from 'next/server';
import * as unitTypesRepo from '../data/unit-types.repo';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { requirePropertyId, propertyErrorStatus } from '@core/auth/tenant-context';

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
    const { category_id, name, code, description, max_adults, max_children, max_occupancy, base_occupancy, beds_single, beds_double, beds_sofa, extra_bed_available, sort_order } = body;

    if (!category_id || !name || !code) {
      return NextResponse.json({ error: 'category_id, name and code are required' }, { status: 400 });
    }

    // Which property, decided here rather than by the caller.
    //
    // The settings screen used to send a literal `prop_main_001` — the id of
    // the FIRST customer's seed property. For every other hotel that row does
    // not exist, so creating a room type through the admin UI answered "not
    // found". A new hotel could not be set up without someone editing code,
    // which is the thing this product must never require.
    //
    // requirePropertyId takes the caller's choice when it is given (and checks
    // it belongs to this organization), uses the organization's only property
    // when there is one, and refuses to guess when there are several.
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

    const created = await unitTypesRepo.createUnitType(actor.organizationId, {
      property_id, category_id, name, code, description,
      max_adults, max_children, max_occupancy, base_occupancy,
      beds_single, beds_double, beds_sofa, extra_bed_available, sort_order,
      bookable_online: body.bookable_online,
      breakfast_included: body.breakfast_included,
    });
    if (!created) return NextResponse.json({ error: 'Property or category not found' }, { status: 404 });
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
    // Прапорці приходять з екрана справжніми булевими — такими й лишаються.
    //
    // Тут стояло зведення до 0/1, бо better-sqlite3 не вміє прив'язати
    // булевий. Тепер це робить шов (`bindable` в core/db/async.ts), і 0/1 у
    // колонку BOOLEAN більше нікуди не їде: `bookable_online` став BOOLEAN
    // разом із рештою прапорців, чиї імена не підпадали під шаблон
    // генератора. `breakfast_included` зберігає третій стан: null означає
    // «вирішує правило каналу».
    if (body.bookable_online !== undefined) {
      body.bookable_online = Boolean(body.bookable_online);
    }
    if (body.breakfast_included !== undefined && body.breakfast_included !== null) {
      body.breakfast_included = Boolean(body.breakfast_included);
    }
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
