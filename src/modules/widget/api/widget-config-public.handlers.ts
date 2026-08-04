/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import { hasFeature, featureDisabled } from '@core/features';

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
    const property = await sql.row<any>('SELECT * FROM properties WHERE id = ? AND is_active = 1', [propertyId]) as any;

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404, headers: CORS_HEADERS });
    }

    if (!hasFeature(getDb(), property.organization_id, 'widget')) {
      return featureDisabled('widget', CORS_HEADERS);
    }

    const unitTypes = await sql.rows<any>(`
      SELECT ut.id, ut.name, ut.code, ut.description,
             ut.max_adults, ut.max_children, ut.max_occupancy, ut.base_occupancy,
             ut.beds_single, ut.beds_double, ut.beds_sofa
      FROM unit_types ut
      WHERE ut.is_active = 1 AND ut.property_id = ?
      ORDER BY ut.sort_order
    `, [property.id]) as any[];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let defaultCheckIn: string | null = null;
    let defaultCheckOut: string | null = null;
    let defaultPrice = 0;
    let defaultUnitTypeId: string | null = null;

    const existingTables = new Set(
      (await sql.rows<any>("SELECT name FROM sqlite_master WHERE type='table'") as { name: string }[])
        .map(t => t.name)
    );
    const hasAvailBlocks = existingTables.has('availability_blocks');

    for (let dayOffset = 0; dayOffset < 60; dayOffset++) {
      const ci = new Date(today);
      ci.setDate(ci.getDate() + dayOffset);
      const co = new Date(ci);
      co.setDate(co.getDate() + 2);

      const ciStr = ci.toISOString().split('T')[0];
      const coStr = co.toISOString().split('T')[0];

      for (const ut of unitTypes) {
        const allUnits = await sql.rows<any>(`
          SELECT u.id FROM units u
          WHERE u.unit_type_id = ? AND u.is_active = 1 AND u.room_status = 'available'
        `, [ut.id]) as any[];

        const bookedUnitIds = await sql.rows<any>(`
          SELECT DISTINCT r.unit_id FROM reservations r
          JOIN units u ON r.unit_id = u.id
          WHERE u.unit_type_id = ?
            AND r.status NOT IN ('cancelled', 'no_show')
            AND r.check_in < ? AND r.check_out > ?
        `, [ut.id, coStr, ciStr]) as any[];

        const bookedIds = new Set(bookedUnitIds.map((r: any) => r.unit_id));

        if (hasAvailBlocks) {
          const blockedUnitIds = await sql.rows<any>(`
            SELECT DISTINCT ab.unit_id FROM availability_blocks ab
            JOIN units u ON ab.unit_id = u.id
            WHERE u.unit_type_id = ?
              AND ab.date_from < ? AND ab.date_to > ?
          `, [ut.id, coStr, ciStr]) as any[];
          for (const b of blockedUnitIds) bookedIds.add(b.unit_id);
        }

        const hasAvailable = allUnits.some((u: any) => !bookedIds.has(u.id));
        if (hasAvailable) {
          defaultCheckIn = ciStr;
          defaultCheckOut = coStr;
          defaultUnitTypeId = ut.id;

          const hasPriceCalendar = existingTables.has('price_calendar');
          let total = 0;

          if (hasPriceCalendar) {
            try {
              const prices = await sql.rows<any>(`
                SELECT pc.date, pc.base_price, pc.weekend_price
                FROM price_calendar pc
                WHERE pc.unit_type_id = ? AND pc.date >= ? AND pc.date < ?
                ORDER BY pc.date ASC
              `, [ut.id, ciStr, coStr]) as any[];

              const priceMap = new Map<string, any>();
              for (const p of prices) priceMap.set(p.date, p);

              const current = new Date(ci);
              for (let i = 0; i < 2; i++) {
                const dateStr = current.toISOString().split('T')[0];
                const dayOfWeek = current.getDay();
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
                const priceEntry = priceMap.get(dateStr);
                let dayPrice = 2500;
                if (priceEntry) {
                  dayPrice = isWeekend && priceEntry.weekend_price != null
                    ? priceEntry.weekend_price : priceEntry.base_price;
                }
                total += dayPrice;
                current.setDate(current.getDate() + 1);
              }
            } catch { total = 2500 * 2; }
          } else {
            total = 2500 * 2;
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
      const asColCheck = (await sql.rows<any>("PRAGMA table_info(additional_services)")).map((c: any) => c.name);
      if (asColCheck.includes('available_in_widget')) {
        widgetServices = await sql.rows<any>(`
          SELECT id, name, name_en, description, price, currency, unit_label, icon, category, available_for
          FROM additional_services
          WHERE property_id = ? AND is_active = 1 AND available_in_widget = 1
          ORDER BY sort_order
        `, [property.id]);
      }
    } catch { /* table may not exist yet */ }

    return NextResponse.json({
      property: {
        id: property.id,
        name: property.name,
        checkInTime: property.check_in_time,
        checkOutTime: property.check_out_time,
        currency: property.default_currency || 'CZK',
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
  } catch (error: any) {
    console.error('GET /api/widget/config error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to load widget config' }, { status: 500, headers: CORS_HEADERS });
  }
}
