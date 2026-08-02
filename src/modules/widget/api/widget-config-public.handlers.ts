/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
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
    const db = getDb();
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
    const property = db
      .prepare('SELECT * FROM properties WHERE id = ? AND is_active = 1')
      .get(propertyId) as any;

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404, headers: CORS_HEADERS });
    }

    if (!hasFeature(db, property.organization_id, 'widget')) {
      return featureDisabled('widget', CORS_HEADERS);
    }

    const unitTypes = db.prepare(`
      SELECT ut.id, ut.name, ut.code, ut.description,
             ut.max_adults, ut.max_children, ut.max_occupancy, ut.base_occupancy,
             ut.beds_single, ut.beds_double, ut.beds_sofa
      FROM unit_types ut
      JOIN categories c ON ut.category_id = c.id
      WHERE c.type = 'glamping' AND ut.is_active = 1 AND ut.property_id = ?
      ORDER BY ut.sort_order
    `).all(property.id) as any[];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let defaultCheckIn: string | null = null;
    let defaultCheckOut: string | null = null;
    let defaultPrice = 0;
    let defaultUnitTypeId: string | null = null;

    const existingTables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
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
        const allUnits = db.prepare(`
          SELECT u.id FROM units u
          WHERE u.unit_type_id = ? AND u.is_active = 1 AND u.room_status = 'available'
        `).all(ut.id) as any[];

        const bookedUnitIds = db.prepare(`
          SELECT DISTINCT r.unit_id FROM reservations r
          JOIN units u ON r.unit_id = u.id
          WHERE u.unit_type_id = ?
            AND r.status NOT IN ('cancelled', 'no_show')
            AND r.check_in < ? AND r.check_out > ?
        `).all(ut.id, coStr, ciStr) as any[];

        const bookedIds = new Set(bookedUnitIds.map((r: any) => r.unit_id));

        if (hasAvailBlocks) {
          const blockedUnitIds = db.prepare(`
            SELECT DISTINCT ab.unit_id FROM availability_blocks ab
            JOIN units u ON ab.unit_id = u.id
            WHERE u.unit_type_id = ?
              AND ab.date_from < ? AND ab.date_to > ?
          `).all(ut.id, coStr, ciStr) as any[];
          for (const b of blockedUnitIds) bookedIds.add(b.unit_id);
        }

        const hasAvailable = allUnits.some((u: any) => !bookedIds.has(u.id));
        if (hasAvailable) {
          defaultCheckIn = ciStr;
          defaultCheckOut = coStr;
          defaultUnitTypeId = ut.id;

          const hasPriceCalendar = existingTables.has('price_calendar');
          const STUB_PRICE = 2500;
          let total = 0;

          if (hasPriceCalendar) {
            try {
              const prices = db.prepare(`
                SELECT pc.date, pc.base_price, pc.weekend_price
                FROM price_calendar pc
                WHERE pc.unit_type_id = ? AND pc.date >= ? AND pc.date < ?
                ORDER BY pc.date ASC
              `).all(ut.id, ciStr, coStr) as any[];

              const priceMap = new Map<string, any>();
              for (const p of prices) priceMap.set(p.date, p);

              const current = new Date(ci);
              for (let i = 0; i < 2; i++) {
                const dateStr = current.toISOString().split('T')[0];
                const dayOfWeek = current.getDay();
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
                const priceEntry = priceMap.get(dateStr);
                let dayPrice = STUB_PRICE;
                if (priceEntry) {
                  dayPrice = isWeekend && priceEntry.weekend_price != null
                    ? priceEntry.weekend_price : priceEntry.base_price;
                }
                total += dayPrice;
                current.setDate(current.getDate() + 1);
              }
            } catch { total = STUB_PRICE * 2; }
          } else {
            total = STUB_PRICE * 2;
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
      const asColCheck = db.prepare("PRAGMA table_info(additional_services)").all().map((c: any) => c.name);
      if (asColCheck.includes('available_in_widget')) {
        widgetServices = db.prepare(`
          SELECT id, name, name_en, description, price, currency, unit_label, icon, category, available_for
          FROM additional_services
          WHERE property_id = ? AND is_active = 1 AND available_in_widget = 1
          ORDER BY sort_order
        `).all(property.id);
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
