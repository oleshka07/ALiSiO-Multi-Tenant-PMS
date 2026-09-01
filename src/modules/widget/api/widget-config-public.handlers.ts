/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { priceNights } from '@pricing';
import { getDb } from '@core/db';
import { hasFeature, featureDisabled } from '@core/features';
import { runWithOrganization } from '@core/auth/tenant-context';
import { availabilityByDay } from '@properties';
import { shiftDays } from '@core/hotel-day';
import { organizationCurrency } from '@core/currency';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function getWidgetConfigOptions() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function getWidgetConfig(request: NextRequest) {
  try {
    const sql = getSql();
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get('propertyId');

    // Public endpoint, no session: the caller has to say which hotel it is
    // configuring. Falling back to the first active property handed one
    // hotel's widget another hotel's rooms, prices and contact details.
    if (!propertyId) {
      return NextResponse.json(
        { error: 'propertyId is required' },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    // Which hotel, before anything is read. `properties` is not readable
    // without a tenant — it is the list of every customer on the server — so
    // the organization comes from the booking site that points at this
    // property. A property with no booking site is not publicly addressable,
    // which is correct: it has no widget.
    const owner = await sql.row<any>(
      "SELECT organization_id FROM booking_sites WHERE property_id = ? AND status != 'deleted' LIMIT 1",
      [propertyId],
    ) as { organization_id: string } | undefined;
    if (!owner?.organization_id) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404, headers: CORS_HEADERS });
    }

    return runWithOrganization(String(owner.organization_id), async () => {

    const property = await sql.row<any>('SELECT * FROM properties WHERE id = ? AND is_active = TRUE', [propertyId]) as any;

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404, headers: CORS_HEADERS });
    }

    if (!await hasFeature(property.organization_id, 'booking_engine')) {
      return featureDisabled('booking_engine', CORS_HEADERS);
    }

    const unitTypes = await sql.rows<any>(`
      SELECT ut.id, ut.name, ut.code, ut.description,
             ut.max_adults, ut.max_children, ut.max_occupancy, ut.base_occupancy,
             ut.beds_single, ut.beds_double, ut.beds_sofa
      FROM unit_types ut
      -- bookable_online: «online nicht buchbar, nur auf Anfrage» — the room
      -- exists, reception sells it, the website must not even show it.
      WHERE ut.is_active = TRUE AND ut.bookable_online = TRUE AND ut.property_id = ?
      ORDER BY ut.sort_order
    `, [property.id]) as any[];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let defaultCheckIn: string | null = null;
    let defaultCheckOut: string | null = null;
    let defaultPrice: number | null = null;
    let defaultUnitTypeId: string | null = null;

    const existingTables = new Set(
      (await sql.rows<any>(sql.dialect.tables()) as { name: string }[])
        .map(t => t.name)
    );

    // Наявність на весь горизонт пошуку — ОДИН раз, а не в циклі. Вікно на
    // добу ширше за останній заїзд: приклад відкривається на дві ночі.
    const horizonFrom = today.toISOString().split('T')[0];
    const horizonTo = new Date(today.getTime() + 62 * 86400000).toISOString().split('T')[0];
    const byDay = await availabilityByDay(property.id, horizonFrom, horizonTo);

    for (let dayOffset = 0; dayOffset < 60; dayOffset++) {
      const ci = new Date(today);
      ci.setDate(ci.getDate() + dayOffset);
      const co = new Date(ci);
      co.setDate(co.getDate() + 2);

      const ciStr = ci.toISOString().split('T')[0];
      const coStr = co.toISOString().split('T')[0];

      for (const ut of unitTypes) {
        // Наявність питається в @properties, а не рахується тут.
        //
        // Було: два-три запити на КОЖЕН тип у КОЖЕН із 60 днів — власна копія
        // розрахунку, яка не знала про броні без призначеного номера. Такі
        // броні не займають жодної конкретної кімнати, тож цей код бачив тип
        // вільним і віджет пропонував продати кімнату, вже продану каналом.
        //
        // Тепер одна відповідь на весь горизонт (обчислена перед циклом), і
        // це те саме джерело, з якого читає батчер ARI: два розрахунки дали б
        // два різні числа на одну дату — інваріант И3.
        // Дві ночі: приклад відкривається на [ci, ci+2), тож вільними мають
        // бути ОБИДВІ — `shiftDays` той самий, що в самому розрахунку.
        const perDay = byDay.get(ut.id);
        const hasAvailable = !!perDay
          && (perDay.get(ciStr) ?? 0) > 0
          && (perDay.get(shiftDays(ciStr, 1)) ?? 0) > 0;
        if (hasAvailable) {
          defaultCheckIn = ciStr;
          defaultCheckOut = coStr;
          defaultUnitTypeId = ut.id;

          // The example price the widget opens with — two nights in the first
          // free category. Through the one resolver, at that category's base
          // occupancy, and null when nothing has priced those nights.
          //
          // The three branches this replaces all ended at 2500 per night: one
          // customer's number, in one customer's currency, offered as every
          // hotel's opening price.
          const hasPriceCalendar = existingTables.has('price_calendar');
          let total: number | null = null;

          if (hasPriceCalendar) {
            try {
              const priced = await priceNights({
                unitTypeId: ut.id, checkIn: ciStr, nights: 2,
                // Показова ціна — за базову заселеність ДОРОСЛИМИ, без дітей.
                adults: Number(ut.base_occupancy) || 2,
              });
              total = priced.missing.length === 0 ? priced.total : null;
            } catch { total = null; }
          }
          defaultPrice = total;
          break;
        }
      }
      if (defaultCheckIn) break;
    }

    // Fetch services available in widget
    let widgetServices: any[] = [];
    try {
      widgetServices = await sql.rows<any>(`
        SELECT id, name, name_en, description, price, currency, unit_label, icon, category, available_for
        FROM additional_services
        WHERE property_id = ? AND is_active = TRUE AND available_in_widget = TRUE
        ORDER BY sort_order
      `, [property.id]);
    } catch { /* table may not exist yet */ }

    return NextResponse.json({
      property: {
        id: property.id,
        name: property.name,
        checkInTime: property.check_in_time,
        checkOutTime: property.check_out_time,
        // Валюта готелю, і це виправлення, а не косметика.
        //
        // Тут стояло `property.default_currency || 'CZK'`, але в таблиці
        // `properties` НЕМАЄ колонки `default_currency` — запит іде через
        // `SELECT *`, тож поле приходило undefined, і запасне значення
        // спрацьовувало ЗАВЖДИ. Публічний віджет кожного готелю — німецького,
        // українського, будь-якого — підписував ціни кронами.
        //
        // Гість бачив число, за яким збирався платити, з чужою валютою: не
        // помилка на екрані, а неправильна ціна на вітрині.
        currency: await organizationCurrency(String(owner.organization_id)),
      },
      unitTypes: unitTypes.map((ut: any) => ({
        id: ut.id,
        name: ut.name,
        code: ut.code,
        description: ut.description,
        maxAdults: ut.max_adults,
        maxChildren: ut.max_children,
        maxOccupancy: ut.max_occupancy,
        bedsDouble: ut.beds_double,
        bedsSingle: ut.beds_single,
      })),
      defaults: {
        checkIn: defaultCheckIn,
        checkOut: defaultCheckOut,
        totalPrice: defaultPrice,
        unitTypeId: defaultUnitTypeId,
        nights: 2,
      },
      services: widgetServices,
    }, { headers: CORS_HEADERS });
    });
  } catch (error: any) {
    console.error('GET /api/widget/config error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to load widget config' }, { status: 500, headers: CORS_HEADERS });
  }
}
