import { NextResponse, type NextRequest } from 'next/server';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { requirePropertyId } from '@core/auth/tenant-context';
import { serverError, handleError } from '@core/http/errors';
import { listRatePlans, createRatePlan, updateRatePlan, deleteRatePlan } from '../data/rate-plans.repo';
import { ratePlansForPayer } from '../data/company-rate-plans.repo';
import type { SellMode, PricingType, AdjustmentKind, AdjustmentDirection } from '../domain/types';

/**
 * Екран «Тарифи» — з боку HTTP. Форма — звичайна акуратність (інваріант 29);
 * усе, що залізне, — у писачі (`data/rate-plans.repo.ts`). Помилки — кодами.
 */

const NAMED: Record<string, number> = {
  code_taken: 409, currency_locked: 409, has_prices: 409, mapped: 409, in_use: 409, sell_mode_locked: 409, has_dependents: 409,
  code_invalid: 400, currency_invalid: 400, name_required: 400, sell_mode_invalid: 400,
  based_on_required: 400, based_on_invalid: 400, adjustment_invalid: 400,
};

/** Поля похідного тарифу (Ц28) з тіла — рядками, звіряє писач. */
function derivedFrom(body: Record<string, unknown>) {
  const out: {
    pricingType?: PricingType | null; basedOnRatePlanId?: string | null;
    adjustmentKind?: AdjustmentKind | null; adjustmentValue?: number | null; adjustmentDirection?: AdjustmentDirection | null;
  } = {};
  if ('pricing_type' in body) out.pricingType = body.pricing_type ? (String(body.pricing_type) as PricingType) : null;
  if ('based_on_rate_plan_id' in body) out.basedOnRatePlanId = body.based_on_rate_plan_id ? String(body.based_on_rate_plan_id) : null;
  if ('adjustment_kind' in body) out.adjustmentKind = body.adjustment_kind ? (String(body.adjustment_kind) as AdjustmentKind) : null;
  if ('adjustment_value' in body) out.adjustmentValue = body.adjustment_value === '' || body.adjustment_value == null ? null : Number(body.adjustment_value);
  if ('adjustment_direction' in body) out.adjustmentDirection = body.adjustment_direction ? (String(body.adjustment_direction) as AdjustmentDirection) : null;
  return out;
}

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
      return handleError('pricing/rate-plans', e);
    }
    return NextResponse.json(await listRatePlans(propertyId));
  } catch (error: unknown) {
    return serverError('modules/pricing/api/rate-plans listRatePlanSettings', error);
  }
});

/**
 * GET /api/pricing/rate-plans/for-payer?property_id=…&company_id=… — той самий
 * список, ЗВУЖЕНИЙ платником (INC-205).
 *
 * Окремий маршрут, а не прапорець на списку вище, і причина не стильова: той
 * список — екран НАЛАШТУВАНЬ, він мусить показувати геть усе, включно з
 * фірмовими тарифами, інакше оператор не зможе ними керувати. Це — екран
 * БРОНІ, і тут питання інше: що може купити ЦЕЙ платник.
 *
 * Тому й варта інша. Налаштуваннями керує `manage_pricing`; бронь заводить
 * будь-хто на рецепції, і вимагати від нього право на ціни означало б, що
 * фірмову бронь може завести лише керівник.
 *
 * Без `company_id` — гість платить сам: фірмових тарифів у відповіді немає
 * жодного. Це не мовчазний дефолт (інваріант 8): «немає фірми» — повноцінна
 * відповідь на питання «хто платить», а не пропущений параметр.
 */
export const listRatePlansForPayer = withActor(async (request: NextRequest, _ctx: unknown, actor: Actor) => {
  try {
    const params = new URL(request.url).searchParams;
    let propertyId: string;
    try {
      propertyId = await requirePropertyId(params.get('property_id'));
    } catch (e) {
      return handleError('pricing/rate-plans/for-payer', e);
    }
    const companyId = params.get('company_id');
    return NextResponse.json(
      await ratePlansForPayer(propertyId, actor.organizationId, companyId && companyId.trim() ? companyId.trim() : null),
    );
  } catch (error: unknown) {
    return handleError('pricing/rate-plans/for-payer', error);
  }
});

/**
 * POST /api/pricing/rate-plans { property_id?, name, code, currency, meal_plan?, sell_mode?, is_hidden?,
 *   pricing_type?, based_on_rate_plan_id?, adjustment_kind?, adjustment_value?, adjustment_direction? }
 * Похідний (Ц28): `pricing_type: 'derived'` з базою і коригуванням — рендериться в календар одразу.
 */
export const createRatePlanSetting = withPermission('manage_pricing', async (request: NextRequest, _ctx: unknown, _actor: Actor) => {
  try {
    const body = (await request.json().catch(() => ({}))) ?? {};
    let propertyId: string;
    try {
      propertyId = await requirePropertyId(typeof body.property_id === 'string' ? body.property_id : null);
    } catch (e) {
      return handleError('pricing/rate-plans', e);
    }
    try {
      const created = await createRatePlan({
        propertyId,
        name: String(body.name ?? ''),
        code: String(body.code ?? ''),
        currency: String(body.currency ?? ''),
        mealPlan: body.meal_plan ? String(body.meal_plan) : null,
        // Писач звіряє зі словником; тут лише рядок, не вгадування.
        sellMode: body.sell_mode == null || body.sell_mode === '' ? null : (String(body.sell_mode) as SellMode),
        isHidden: typeof body.is_hidden === 'boolean' ? body.is_hidden : undefined,
        ...derivedFrom(body),
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
 * PATCH /api/pricing/rate-plans/[id] { name?, code?, currency?, meal_plan?, is_active?, sell_mode?, is_hidden?, pricing_type?, … }
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
    if (typeof body.is_active === 'boolean') patch.isActive = body.is_active;
    if (typeof body.sell_mode === 'string') patch.sellMode = body.sell_mode as SellMode;
    if (typeof body.is_hidden === 'boolean') patch.isHidden = body.is_hidden;
    Object.assign(patch, derivedFrom(body));
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
