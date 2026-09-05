import { NextResponse, type NextRequest } from 'next/server';
import { withPermission, type Actor } from '@core/auth/session';
import { requirePropertyId, propertyErrorStatus } from '@core/auth/tenant-context';
import { serverError } from '@core/http/errors';
import { listRules, createRule, updateRule, deleteRule, ageBandsOf, type RuleInput } from '../data/extra-occupancy.repo';
import type { GuestKind, SurchargeMode } from '../domain/extra-occupancy';

/**
 * Екран «Надбавки за заселеність» — з боку HTTP (Блок 2 крок 3, Ц30). Форма
 * — звичайна акуратність (інваріант 29); усе залізне — у писачі
 * (`data/extra-occupancy.repo.ts`). Помилки — кодами; чуже — 404.
 */

const NAMED: Record<string, number> = {
  rule_conflict: 409, rule_invalid: 400,
  rule_not_found: 404, rate_plan_not_found: 404, unit_type_not_found: 404, property_not_found: 404,
};

function named(error: unknown): NextResponse | null {
  const message = error instanceof Error ? error.message : '';
  if (message in NAMED) return NextResponse.json({ error: message }, { status: NAMED[message] });
  return null;
}

function inputFrom(body: Record<string, unknown>): RuleInput {
  return {
    ratePlanId: body.rate_plan_id ? String(body.rate_plan_id) : null,
    unitTypeId: body.unit_type_id ? String(body.unit_type_id) : null,
    guestKind: String(body.guest_kind ?? '') as GuestKind,
    ageBandIndex: body.age_band_index == null || body.age_band_index === '' ? null : Number(body.age_band_index),
    lodgingMode: body.lodging_mode ? (String(body.lodging_mode) as SurchargeMode) : null,
    lodgingValue: body.lodging_value == null || body.lodging_value === '' ? null : Number(body.lodging_value),
    mealMode: body.meal_mode ? (String(body.meal_mode) as SurchargeMode) : null,
    mealValue: body.meal_value == null || body.meal_value === '' ? null : Number(body.meal_value),
    extraBed: body.extra_bed === true,
  };
}

type Params = { params: Promise<{ id: string }> };

/** GET /api/pricing/extra-occupancy?property_id=… → { rules, bands } */
export const listExtraOccupancyRules = withPermission('manage_pricing', async (request: NextRequest, _ctx: unknown, actor: Actor) => {
  try {
    let propertyId: string;
    try {
      propertyId = await requirePropertyId(new URL(request.url).searchParams.get('property_id'));
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Property not found' }, { status: propertyErrorStatus(e) });
    }
    try {
      const [rules, bands] = await Promise.all([listRules(propertyId), ageBandsOf(actor.organizationId)]);
      return NextResponse.json({ rules, bands });
    } catch (error: unknown) {
      return named(error) ?? serverError('modules/pricing/api/extra-occupancy list', error);
    }
  } catch (error: unknown) {
    return serverError('modules/pricing/api/extra-occupancy list', error);
  }
});

/** POST /api/pricing/extra-occupancy { property_id?, rate_plan_id?, unit_type_id?, guest_kind, age_band_index?, lodging_mode?, lodging_value?, meal_mode?, meal_value?, extra_bed? } */
export const createExtraOccupancyRule = withPermission('manage_pricing', async (request: NextRequest, _ctx: unknown, _actor: Actor) => {
  try {
    const body = (await request.json().catch(() => ({}))) ?? {};
    let propertyId: string;
    try {
      propertyId = await requirePropertyId(typeof body.property_id === 'string' ? body.property_id : null);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Property not found' }, { status: propertyErrorStatus(e) });
    }
    try {
      return NextResponse.json(await createRule(propertyId, inputFrom(body)), { status: 201 });
    } catch (error: unknown) {
      return named(error) ?? serverError('modules/pricing/api/extra-occupancy create', error);
    }
  } catch (error: unknown) {
    return serverError('modules/pricing/api/extra-occupancy create', error);
  }
});

/** PATCH /api/pricing/extra-occupancy/[id] — усі поля правила. */
export const updateExtraOccupancyRule = withPermission('manage_pricing', async (request: NextRequest, { params }: Params, _actor: Actor) => {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) ?? {};
    try {
      return NextResponse.json(await updateRule(id, inputFrom(body)));
    } catch (error: unknown) {
      return named(error) ?? serverError('modules/pricing/api/extra-occupancy update', error);
    }
  } catch (error: unknown) {
    return serverError('modules/pricing/api/extra-occupancy update', error);
  }
});

/** DELETE /api/pricing/extra-occupancy/[id] */
export const deleteExtraOccupancyRule = withPermission('manage_pricing', async (_request: NextRequest, { params }: Params, _actor: Actor) => {
  try {
    const { id } = await params;
    try {
      await deleteRule(id);
      return NextResponse.json({ ok: true });
    } catch (error: unknown) {
      return named(error) ?? serverError('modules/pricing/api/extra-occupancy delete', error);
    }
  } catch (error: unknown) {
    return serverError('modules/pricing/api/extra-occupancy delete', error);
  }
});
