import { NextResponse, type NextRequest } from 'next/server';
import { withPermission, type Actor } from '@core/auth/session';
import { requirePropertyId } from '@core/auth/tenant-context';
import { serverError, handleError } from '@core/http/errors';
import { listRules, createRule, updateRule, deleteRule, type RuleInput } from '../data/price-rules.repo';
import type { RuleKind, RuleCondition, RuleAction, RuleValueKind } from '../domain/price-rules';

/**
 * Екран «Правила цін і промо» — з боку HTTP (Блок 2 крок 4, Ц31). Форма —
 * звичайна акуратність (інваріант 29); усе залізне — у писачі
 * (`data/price-rules.repo.ts`). Помилки — кодами; чуже — 404.
 */

const NAMED: Record<string, number> = {
  rule_invalid: 400, rule_name_required: 400, rule_value_invalid: 400, promo_code_required: 400,
  promo_code_taken: 409,
  rule_not_found: 404, rate_plan_not_found: 404, unit_type_not_found: 404, property_not_found: 404,
};

function named(error: unknown): NextResponse | null {
  const message = error instanceof Error ? error.message : '';
  if (message in NAMED) return NextResponse.json({ error: message }, { status: NAMED[message] });
  return null;
}

const numOrNull = (v: unknown) => (v == null || v === '' ? null : Number(v));
const strList = (v: unknown): string[] | null => (Array.isArray(v) && v.length ? v.map(String) : null);
const numList = (v: unknown): number[] | null => (Array.isArray(v) && v.length ? v.map(Number) : null);

function inputFrom(body: Record<string, unknown>): RuleInput {
  return {
    name: String(body.name ?? ''),
    titleForGuest: body.title_for_guest == null ? null : String(body.title_for_guest),
    kind: (body.kind === 'promo' ? 'promo' : 'rule') as RuleKind,
    code: body.code == null ? null : String(body.code),
    conditionKind: body.condition_kind ? (String(body.condition_kind) as RuleCondition) : null,
    dateFrom: body.date_from ? String(body.date_from) : null,
    dateTo: body.date_to ? String(body.date_to) : null,
    weekDays: numList(body.week_days),
    ratePlanIds: strList(body.rate_plan_ids),
    unitTypeIds: strList(body.unit_type_ids),
    minLos: numOrNull(body.min_los),
    maxLos: numOrNull(body.max_los),
    bookedDaysBeforeFrom: numOrNull(body.booked_days_before_from),
    bookedDaysBeforeTo: numOrNull(body.booked_days_before_to),
    occupancyFrom: numOrNull(body.occupancy_from),
    occupancyTo: numOrNull(body.occupancy_to),
    action: String(body.action ?? '') as RuleAction,
    value: Number(body.value),
    valueKind: String(body.value_kind ?? '') as RuleValueKind,
    priority: numOrNull(body.priority),
    isActive: body.is_active === undefined ? true : Boolean(body.is_active),
    onlineOnly: body.online_only === true,
    maxUses: numOrNull(body.max_uses),
  };
}

type Params = { params: Promise<{ id: string }> };

/** GET /api/pricing/price-rules?property_id=… */
export const listPriceRules = withPermission('manage_pricing', async (request: NextRequest, _ctx: unknown, _actor: Actor) => {
  try {
    let propertyId: string;
    try {
      propertyId = await requirePropertyId(new URL(request.url).searchParams.get('property_id'));
    } catch (e) {
      return handleError('pricing/price-rules', e);
    }
    try {
      return NextResponse.json(await listRules(propertyId));
    } catch (error: unknown) {
      return named(error) ?? serverError('modules/pricing/api/price-rules list', error);
    }
  } catch (error: unknown) {
    return serverError('modules/pricing/api/price-rules list', error);
  }
});

/** POST /api/pricing/price-rules — усі поля правила; `kind: 'promo'` + `code` для промо. */
export const createPriceRule = withPermission('manage_pricing', async (request: NextRequest, _ctx: unknown, _actor: Actor) => {
  try {
    const body = (await request.json().catch(() => ({}))) ?? {};
    let propertyId: string;
    try {
      propertyId = await requirePropertyId(typeof body.property_id === 'string' ? body.property_id : null);
    } catch (e) {
      return handleError('pricing/price-rules', e);
    }
    try {
      return NextResponse.json(await createRule(propertyId, inputFrom(body)), { status: 201 });
    } catch (error: unknown) {
      return named(error) ?? serverError('modules/pricing/api/price-rules create', error);
    }
  } catch (error: unknown) {
    return serverError('modules/pricing/api/price-rules create', error);
  }
});

/** PATCH /api/pricing/price-rules/[id] — усі поля правила. */
export const updatePriceRule = withPermission('manage_pricing', async (request: NextRequest, { params }: Params, _actor: Actor) => {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) ?? {};
    try {
      return NextResponse.json(await updateRule(id, inputFrom(body)));
    } catch (error: unknown) {
      return named(error) ?? serverError('modules/pricing/api/price-rules update', error);
    }
  } catch (error: unknown) {
    return serverError('modules/pricing/api/price-rules update', error);
  }
});

/** DELETE /api/pricing/price-rules/[id] */
export const deletePriceRule = withPermission('manage_pricing', async (_request: NextRequest, { params }: Params, _actor: Actor) => {
  try {
    const { id } = await params;
    try {
      await deleteRule(id);
      return NextResponse.json({ ok: true });
    } catch (error: unknown) {
      return named(error) ?? serverError('modules/pricing/api/price-rules delete', error);
    }
  } catch (error: unknown) {
    return serverError('modules/pricing/api/price-rules delete', error);
  }
});
