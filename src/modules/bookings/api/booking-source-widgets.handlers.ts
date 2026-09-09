/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { handleError } from '@core/http/errors';
import { withActor, type Actor } from '@core/auth/session';
import { requestPropertyScope } from '@core/auth/property-scope';
import { widgetSiteSourcesOf } from '../data/lists.repo';

/**
 * GET /api/booking-sources/widget-sites
 *
 * Сайти бронювання як псевдо-джерела для форми броні: кожен подається у формі
 * `BookingSourceRow`, щоб випадний список рендерив їх групою «Віджети». Код
 * має префікс `widget:`, щоб бекенд відрізняв ручний запис із віджета від
 * звичайного джерела OTA.
 *
 * Який ОБʼЄКТ, а не лише який орендар (INC-029): рецепція будинку А бачила в
 * цьому списку сайти будинку Б і могла приписати бронь чужому сайту — а
 * джерело броні це комісія, звітність і атрибуція. Запит і його доводи — у
 * `data/lists.repo.ts`: `withActor` кличе `cookies()`, тож сцени на хендлер не
 * буває.
 */
export const listWidgetSiteSources = withActor(async (request: Request, _ctx, actor: Actor) => {
  try {
    const scope = await requestPropertyScope(request, actor.organizationId);
    const sites = await widgetSiteSourcesOf(actor.organizationId, scope) as any[];

    return NextResponse.json(sites.map((s) => ({
      code: `widget:${s.id}`,
      name: s.name || s.slug || s.id,
      color: '#6366f1',        // indigo — consistent "widget" brand colour
      icon_letter: '🌐',
      commission_percent: 0,
      city_tax_included_default: 0,
      site_url: s.site_url || null,
      site_id: s.id,
    })));
  } catch (e: unknown) {
    // Названа відмова їде своїм статусом: чужий `property_id` — 404, не 500.
    return handleError('modules/bookings/api/booking-source-widgets listWidgetSiteSources', e);
  }
});
