import { NextResponse, type NextRequest } from 'next/server';
import { withPermission, type Actor } from '@core/auth/session';
import { requirePropertyId } from '@core/auth/tenant-context';
import { serverError, handleError } from '@core/http/errors';
import {
  listSeasons, createSeason, updateSeason, deleteSeason, splitSeason,
  seasonPrices, setSeasonPrice, deleteSeasonPrice, clearSeasonOverrides,
} from '../data/seasons.repo';

/**
 * Екран «Сезони» — з боку HTTP (Блок 2 крок 1, Ц27). Форма — звичайна
 * акуратність (інваріант 29); усе залізне — у писачі (`data/seasons.repo.ts`):
 * без перетинів, рендер через двері каналу, перевизначення живе. Помилки —
 * кодами, екран їх перекладає. Чуже — 404 (інваріант 5).
 */

const NAMED: Record<string, number> = {
  season_overlap: 409, season_dates_invalid: 400, season_name_required: 400, season_split_invalid: 400,
  price_not_positive: 400, rate_plan_derived: 400, unit_type_not_found: 404, rate_plan_not_found: 404, season_not_found: 404, property_not_found: 404,
};

function named(error: unknown): NextResponse | null {
  const message = error instanceof Error ? error.message : '';
  if (message in NAMED) return NextResponse.json({ error: message }, { status: NAMED[message] });
  return null;
}

type Params = { params: Promise<{ id: string }> };

/** GET /api/pricing/seasons?property_id=…&include_past=1 */
export const listSeasonSettings = withPermission('manage_pricing', async (request: NextRequest, _ctx: unknown, _actor: Actor) => {
  try {
    const url = new URL(request.url);
    let propertyId: string;
    try {
      propertyId = await requirePropertyId(url.searchParams.get('property_id'));
    } catch (e) {
      return handleError('pricing/seasons', e);
    }
    return NextResponse.json(await listSeasons(propertyId, { includePast: url.searchParams.get('include_past') === '1' }));
  } catch (error: unknown) {
    return serverError('modules/pricing/api/seasons listSeasonSettings', error);
  }
});

/** POST /api/pricing/seasons { property_id?, name, date_from, date_to } */
export const createSeasonSetting = withPermission('manage_pricing', async (request: NextRequest) => {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    let propertyId: string;
    try {
      propertyId = await requirePropertyId(typeof body.property_id === 'string' ? body.property_id : null);
    } catch (e) {
      return handleError('pricing/seasons', e);
    }
    const season = await createSeason({ propertyId, name: String(body.name ?? ''), dateFrom: String(body.date_from ?? ''), dateTo: String(body.date_to ?? '') });
    return NextResponse.json(season, { status: 201 });
  } catch (error: unknown) {
    return named(error) ?? serverError('modules/pricing/api/seasons createSeasonSetting', error);
  }
});

/** PATCH /api/pricing/seasons/[id] { name?, date_from?, date_to? } */
export const updateSeasonSetting = withPermission('manage_pricing', async (request: NextRequest, { params }: Params) => {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const season = await updateSeason(id, {
      ...(body.name !== undefined ? { name: String(body.name) } : {}),
      ...(body.date_from !== undefined ? { dateFrom: String(body.date_from) } : {}),
      ...(body.date_to !== undefined ? { dateTo: String(body.date_to) } : {}),
    });
    return NextResponse.json(season);
  } catch (error: unknown) {
    return named(error) ?? serverError('modules/pricing/api/seasons updateSeasonSetting', error);
  }
});

/** DELETE /api/pricing/seasons/[id] */
export const deleteSeasonSetting = withPermission('manage_pricing', async (_request: NextRequest, { params }: Params) => {
  try {
    const { id } = await params;
    await deleteSeason(id);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return named(error) ?? serverError('modules/pricing/api/seasons deleteSeasonSetting', error);
  }
});

/** POST /api/pricing/seasons/[id]/split { date } */
export const splitSeasonSetting = withPermission('manage_pricing', async (request: NextRequest, { params }: Params) => {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    return NextResponse.json(await splitSeason(id, String(body.date ?? '')));
  } catch (error: unknown) {
    return named(error) ?? serverError('modules/pricing/api/seasons splitSeasonSetting', error);
  }
});

/** GET /api/pricing/seasons/[id]/prices */
export const listSeasonPriceCells = withPermission('manage_pricing', async (_request: NextRequest, { params }: Params) => {
  try {
    const { id } = await params;
    return NextResponse.json(await seasonPrices(id));
  } catch (error: unknown) {
    return named(error) ?? serverError('modules/pricing/api/seasons listSeasonPriceCells', error);
  }
});

/** PUT /api/pricing/seasons/[id]/prices { unit_type_id, rate_plan_id|null, price, weekend_price|null } — записує клітинку і рендерить сезон у календар. */
export const putSeasonPriceCell = withPermission('manage_pricing', async (request: NextRequest, { params }: Params) => {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const cell = await setSeasonPrice(id, {
      unitTypeId: String(body.unit_type_id ?? ''),
      ratePlanId: typeof body.rate_plan_id === 'string' && body.rate_plan_id ? body.rate_plan_id : null,
      price: Number(body.price),
      weekendPrice: body.weekend_price == null || body.weekend_price === '' ? null : Number(body.weekend_price),
    });
    return NextResponse.json(cell);
  } catch (error: unknown) {
    return named(error) ?? serverError('modules/pricing/api/seasons putSeasonPriceCell', error);
  }
});

/** DELETE /api/pricing/seasons/[id]/prices?unit_type_id=…&rate_plan_id=… — прибрати клітинку (календар не чіпається). */
export const deleteSeasonPriceCell = withPermission('manage_pricing', async (request: NextRequest, { params }: Params) => {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    await deleteSeasonPrice(id, url.searchParams.get('unit_type_id') ?? '', url.searchParams.get('rate_plan_id') || null);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return named(error) ?? serverError('modules/pricing/api/seasons deleteSeasonPriceCell', error);
  }
});

/** POST /api/pricing/seasons/[id]/clear-overrides — перерендер поверх точкових перевизначень дат. */
export const clearSeasonOverridesSetting = withPermission('manage_pricing', async (_request: NextRequest, { params }: Params) => {
  try {
    const { id } = await params;
    return NextResponse.json({ ok: true, cells: await clearSeasonOverrides(id) });
  } catch (error: unknown) {
    return named(error) ?? serverError('modules/pricing/api/seasons clearSeasonOverridesSetting', error);
  }
});
