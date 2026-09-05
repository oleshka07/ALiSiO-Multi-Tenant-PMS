import { NextResponse, type NextRequest } from 'next/server';
import { withPermission, type Actor } from '@core/auth/session';
import { requirePropertyId, propertyErrorStatus } from '@core/auth/tenant-context';
import { serverError } from '@core/http/errors';
import { listRatePlans, createRatePlan, updateRatePlan, deleteRatePlan } from '../data/rate-plans.repo';
import type { SellMode } from '../domain/types';

/**
 * Екран «Тарифи» — з боку HTTP. Форма — звичайна акуратність (інваріант 29);
 * усе, що залізне, — у писачі (`data/rate-plans.repo.ts`). Помилки — кодами.
 */

const NAMED: Record<string, number> = {
  code_taken: 409, currency_locked: 409, has_prices: 409, mapped: 409, in_use: 409, sell_mode_locked: 409,
  code_invalid: 400, currency_invalid: 400, name_required: 400, child_price_invalid: 400, sell_mode_invalid: 400,
};

function named(error: unknown): NextResponse | null {
  const message = error instanceof Error ? error.message : '';
  if (message in NAMED) return NextResponse.json({ error: message }, { status: NAMED[message] });
  if (/not found/i.test(message)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return null;
}

/** GET /api/pricing/rate-plans?property_id=… */
export const listRatePlanSettings = withPermission('manage_pricing', async (request: NextRequest, _ctx: unknown, _actor: Actor) => {
  try {
    let propertyId: string;
    try {
      propertyId = await requirePropertyId(new URL(request.url).searchParams.get('property_id'));
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Property not found' }, { status: propertyErrorStatus(e) });
    }
    return NextResponse.json(await listRatePlans(propertyId));
  } catch (error: unknown) {
    return serverError('modules/pricing/api/rate-plans listRatePlanSettings', error);
  }
});

/** POST /api/pricing/rate-plans { property_id?, name, code, currency, meal_plan?, child_extra_gross?, sell_mode? } */
export const createRatePlanSetting = withPermission('manage_pricing', async (request: NextRequest, _ctx: unknown, _actor: Actor) => {
  try {
    const body = (await request.json().catch(() => ({}))) ?? {};
    let propertyId: string;
    try {
      propertyId = await requirePropertyId(typeof body.property_id === 'string' ? body.property_id : null);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Property not found' }, { status: propertyErrorStatus(e) });
    }
    try {
      const created = await createRatePlan({
        propertyId,
        name: String(body.name ?? ''),
        code: String(body.code ?? ''),
        currency: String(body.currency ?? ''),
        mealPlan: body.meal_plan ? String(body.meal_plan) : null,
        childExtraGross: body.child_extra_gross === '' || body.child_extra_gross == null ? null : Number(body.child_extra_gross),
        // Писач звіряє зі словником; тут лише рядок, не вгадування.
        sellMode: body.sell_mode == null || body.sell_mode === '' ? null : (String(body.sell_mode) as SellMode),
      });
      return NextResponse.json(created, { status: 201 });
    } catch (error: unknown) {
      return named(error) ?? serverError('modules/pricing/api/rate-plans createRatePlanSetting', error);
    }
  } catch (error: unknown) {
    return serverError('modules/pricing/api/rate-plans createRatePlanSetting', error);
  }
});

/**
 * PATCH /api/pricing/rate-plans/[id] { name?, code?, currency?, meal_plan?, child_extra_gross?, is_active?, sell_mode? }
 *
 * `is_active: false` — зняти з продажу (канал закриє ночі до горизонту),
 * `true` — повернути. Лише boolean: рядок «false» тут був би правдою.
 * `sell_mode` — лише доки тариф не заведено у вендора (`sell_mode_locked`).
 */
export const updateRatePlanSetting = withPermission('manage_pricing', async (request: NextRequest, { params }: { params: Promise<{ id: string }> }, _actor: Actor) => {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) ?? {};
    const patch: Parameters<typeof updateRatePlan>[1] = {};
    if (typeof body.name === 'string') patch.name = body.name;
    if (typeof body.code === 'string') patch.code = body.code;
    if (typeof body.currency === 'string') patch.currency = body.currency;
    if ('meal_plan' in body) patch.mealPlan = body.meal_plan ? String(body.meal_plan) : null;
    if ('child_extra_gross' in body) patch.childExtraGross = body.child_extra_gross === '' || body.child_extra_gross == null ? null : Number(body.child_extra_gross);
    if (typeof body.is_active === 'boolean') patch.isActive = body.is_active;
    if (typeof body.sell_mode === 'string') patch.sellMode = body.sell_mode as SellMode;
    try {
      return NextResponse.json(await updateRatePlan(id, patch));
    } catch (error: unknown) {
      return named(error) ?? serverError('modules/pricing/api/rate-plans updateRatePlanSetting', error);
    }
  } catch (error: unknown) {
    return serverError('modules/pricing/api/rate-plans updateRatePlanSetting', error);
  }
});

/**
 * DELETE /api/pricing/rate-plans/[id]
 *
 * Лише чистий тариф: з цінами — `has_prices`, заведений у вендора — `mapped`,
 * з бронюваннями — `in_use` (усі 409, названі). Чужий — 404, не 403
 * (інваріант 5).
 */
export const deleteRatePlanSetting = withPermission('manage_pricing', async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }, _actor: Actor) => {
  try {
    const { id } = await params;
    try {
      await deleteRatePlan(id);
      return NextResponse.json({ ok: true });
    } catch (error: unknown) {
      return named(error) ?? serverError('modules/pricing/api/rate-plans deleteRatePlanSetting', error);
    }
  } catch (error: unknown) {
    return serverError('modules/pricing/api/rate-plans deleteRatePlanSetting', error);
  }
});
