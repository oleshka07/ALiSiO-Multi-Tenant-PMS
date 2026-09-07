/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getPriceMonth, upsertPrices } from '../data/price-calendar.repo';
import { monthOrigins } from '../data/month-origins';
import { pricingAdvanced, setPricingAdvanced } from '../data/price-mode.repo';
import type { PriceOrigin } from '../domain/day-price';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { handleError } from '@core/http/errors';
import { ownedUnitType } from '../data/owned.repo';

export const getPricing = withActor(async (request: NextRequest, _ctx, actor: Actor): Promise<NextResponse> => {
  try {
    const { searchParams } = new URL(request.url);
    const unitTypeId = searchParams.get('unitTypeId');
    const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1));
    const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()));

    if (!unitTypeId) return NextResponse.json({ error: 'unitTypeId is required' }, { status: 400 });

    // price_calendar is keyed by unit type alone, and the id comes from the
    // query string — so without this a logged-in user of any hotel could read
    // and rewrite another hotel's rates.
    if (!await ownedUnitType(unitTypeId, actor.organizationId)) {
      return NextResponse.json({ error: 'Unit type not found' }, { status: 404 });
    }

    const ratePlanId = searchParams.get('ratePlanId') || undefined;
    const grid = await getPriceMonth(unitTypeId, month, year, ratePlanId);

    // ── Звідки взялося число, яке побачить оператор ──────────────────────
    //
    // Сітка знає лише рядки календаря, а гість платить за іншим правилом:
    // МАТРИЦЯ заселеності перекриває календар (`nightly-price.ts`). Тому
    // підпис джерела береться з того самого резолвера, що й ціна гостя —
    // одним викликом на місяць, — а не виводиться з полів рядка. Інакше
    // клітинка казала б «базова 100», поки гість платить 120 з матриці:
    // рівно той рід мовчання, через який заведено весь Блок 6.
    //
    // Помилка тут не має ламати екран цін: підпис — це допомога, а не ціна.
    let origins: Record<string, PriceOrigin> = {};
    try {
      origins = await monthOrigins(unitTypeId, month, year, ratePlanId);
    } catch (e) {
      console.error('[pricing] month origins:', e instanceof Error ? e.message : e);
    }

    return NextResponse.json({
      ...grid,
      days: grid.days.map((d) => ({ ...d, origin: origins[d.date] ?? null })),
      advancedPricing: await pricingAdvanced(actor.organizationId),
    });
  } catch (error: any) {
    console.error('GET /api/pricing error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to fetch pricing' }, { status: 500 });
  }
});

export const updatePricing = withPermission('manage_pricing', async (request: NextRequest, _ctx, actor: Actor): Promise<NextResponse> => {
  try {
    const body = await request.json();
    const { unitTypeId, prices } = body;

    if (!unitTypeId || !Array.isArray(prices) || prices.length === 0) {
      return NextResponse.json({ error: 'unitTypeId and prices array required' }, { status: 400 });
    }

    if (!await ownedUnitType(unitTypeId, actor.organizationId)) {
      return NextResponse.json({ error: 'Unit type not found' }, { status: 404 });
    }

    const ratePlanId = typeof body.ratePlanId === 'string' && body.ratePlanId ? body.ratePlanId : undefined;
    let updated: number;
    try {
      // Обмеження з названим тарифом — у пару (дефолт) або «на всі тарифи
      // типу» (Ц32 переглянуто 07.09) — вирішує прапорець екрана.
      const restrictionsScope = body.restrictionsScope === 'type' ? 'type' as const : undefined;
      updated = await upsertPrices(unitTypeId, prices, { ratePlanId, restrictionsScope });
    } catch (e) {
      if (e instanceof Error && /rate plan not found/i.test(e.message)) return NextResponse.json({ error: 'Rate plan not found' }, { status: 404 });
      // Нуль і відʼємне — не ціна (2.0): названа відмова, екран її перекладає.
      if (e instanceof Error && e.message === 'price_not_positive') return NextResponse.json({ error: 'price_not_positive' }, { status: 400 });
      // Мінімум ночей менший за одиницю — те саме, що нуль у ціні: названа
      // відмова, а не запис (рецензія 07.09 раунд 3, правка 1.1).
      if (e instanceof Error && e.message === 'min_stay_invalid') return NextResponse.json({ error: 'min_stay_invalid' }, { status: 400 });
      throw e;
    }

    // A price change used to enqueue an ARI push here, wrapped in a try/catch
    // that swallowed the error — which is how nobody noticed the queue was
    // never drained. Both the queue and the Connectivity API it fed are gone.
    // When a channel with its own API arrives, it subscribes to a
    // `pricing.updated` event; it does not get a hidden call inside this
    // handler.

    return NextResponse.json({ success: true, updated });
  } catch (error: any) {
    console.error('PUT /api/pricing error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to update pricing' }, { status: 500 });
  }
});

/**
 * PUT /api/pricing/mode { advanced: boolean } — «розширені ціни» для готелю.
 *
 * Право те саме, що на самі ціни: перемикач вирішує, які поля оператор бачить
 * і, отже, які числа може змінити.
 */
export const setPricingMode = withPermission('manage_pricing', async (request: NextRequest, _ctx, actor: Actor): Promise<NextResponse> => {
  try {
    const body = await request.json();
    if (typeof body?.advanced !== 'boolean') {
      return NextResponse.json({ error: 'advanced must be a boolean' }, { status: 400 });
    }
    await setPricingAdvanced(actor.organizationId, body.advanced);
    return NextResponse.json({ advanced: body.advanced });
  } catch (error: unknown) {
    return handleError('modules/pricing/api/pricing setPricingMode', error);
  }
});
