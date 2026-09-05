/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withSite } from '../data/site.repo';
import { money } from '@core/money';
import { requireOrganizationId } from '@core/auth/tenant-context';

// Колонка `currency` тут NOT NULL, тож `|| 'CZK'` не спрацьовував ніколи —
// це не захист, а вигляд рішення: читач вірив, що порожня валюта буває.

/**
 * `additional_services` reaches its tenant through `property_id → properties`,
 * which is exactly what the Postgres policy says. Repeated here because the
 * widget also runs on SQLite, where there are no policies: `withSite` sets the
 * organization and nothing enforced it, so the service list a guest saw on one
 * hotel's booking page was every hotel's active services, at their prices, and
 * `serviceId` from the query string opened any of them.
 */
const OWNED_SERVICE = 'property_id IN (SELECT id FROM properties WHERE organization_id = ?)';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function getWidgetServicesOptions() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function getWidgetServices(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const answer = await withSite(searchParams.get('siteId'), () => servicesFor(searchParams));
  return answer ?? NextResponse.json({ error: 'Unknown site' }, { status: 404, headers: CORS_HEADERS });
}

async function servicesFor(searchParams: URLSearchParams) {
  try {
    const sql = getSql();
    // Set by withSite above, from the site's own row.
    const organizationId = await requireOrganizationId();
    const checkIn = searchParams.get('checkIn');
    const checkOut = searchParams.get('checkOut');
    const serviceId = searchParams.get('serviceId');
    const siteId = searchParams.get('siteId') || '';

    const existingTables = new Set(
      (await sql.rows<any>(sql.dialect.tables()) as { name: string }[])
        .map(t => t.name)
    );

    if (!existingTables.has('additional_services')) {
      return NextResponse.json({ services: [] }, { headers: CORS_HEADERS });
    }

    if (serviceId && checkIn && checkOut) {
      const service = await sql.row<any>(
        `SELECT * FROM additional_services WHERE id = ? AND is_active = TRUE AND ${OWNED_SERVICE}`,
        [serviceId, organizationId]) as any;
      if (!service) {
        return NextResponse.json({ error: 'Service not found' }, { status: 404, headers: CORS_HEADERS });
      }

      const result: any = { ...formatService(service) };

      if (service.service_type === 'slot_booking' && existingTables.has('service_time_slots')) {
        await sql.run(`
          UPDATE service_time_slots
          SET booked_count = MAX(0, booked_count - 1), booking_session_id = NULL
          WHERE booking_session_id IS NOT NULL
            AND notes IS NULL
            AND created_at < ${sql.dialect.plusMinutes('CURRENT_TIMESTAMP', '-1 * ?')}
        `, [15]);

        const bookedSlots = await sql.rows<any>(`
          SELECT date, start_time, end_time, booked_count, max_capacity
          FROM service_time_slots
          WHERE service_id = ? AND date >= ? AND date < ? AND booked_count >= max_capacity
        `, [serviceId, checkIn, checkOut]) as any[];
        result.bookedSlots = bookedSlots;
      }

      if (service.service_type === 'menu_selection' && existingTables.has('menu_items')) {
        const items = await sql.rows<any>('SELECT * FROM menu_items WHERE service_id = ? AND is_available = TRUE ORDER BY sort_order', [serviceId]) as any[];
        result.menuItems = items.map(item => ({
          id: item.id,
          name: item.name,
          nameEn: item.name_en,
          nameCs: item.name_cs,
          nameDe: item.name_de,
          description: item.description,
          descriptionEn: item.description_en,
          descriptionCs: item.description_cs,
          descriptionDe: item.description_de,
          weightGrams: item.weight_grams,
          price: item.price,
          photoUrl: item.photo_url,
        }));
      }

      if (existingTables.has('service_addons')) {
        const addons = await sql.rows<any>('SELECT * FROM service_addons WHERE service_id = ? ORDER BY sort_order', [serviceId]) as any[];
        result.addons = addons.map(a => ({
          id: a.id,
          name: a.name,
          nameEn: a.name_en,
          nameCs: a.name_cs,
          nameDe: a.name_de,
          price: a.price,
          icon: a.icon,
        }));
      }

      return NextResponse.json(result, { headers: CORS_HEADERS });
    }

    // ── List services ─────────────────────────────────────────────────────
    // If siteId is provided → filter by site_services (respect price_override)
    // Otherwise → return all active services (for /booking desktop page)
    const hasSiteServices = existingTables.has('site_services');

    let services: any[];

    if (siteId && hasSiteServices) {
      // Services enabled for this booking site (defaulting to enabled if no explicit config)
      services = await sql.rows<any>(`
        SELECT s.*, ss.price_override, ss.photo_override,
               COALESCE(ss.sort_order, s.sort_order) as site_sort_order, 
               COALESCE(ss.is_enabled, TRUE) as is_enabled
        FROM additional_services s
        LEFT JOIN site_services ss ON ss.service_id = s.id AND ss.site_id = ?
        WHERE s.is_active = TRUE AND COALESCE(ss.is_enabled, TRUE) = TRUE
          AND s.${OWNED_SERVICE}
        ORDER BY COALESCE(ss.sort_order, s.sort_order), s.sort_order
      `, [siteId, organizationId]) as any[];

      // Apply price_override where set
      services = services.map(s => ({
        ...s,
        price: s.price_override != null ? s.price_override : s.price,
      }));
    } else {
      // Fallback: the property's active services. The old filter also let
      // through available_for = 'glamping', one hotel's category name.
      services = await sql.rows<any>(`
        SELECT * FROM additional_services
        WHERE is_active = TRUE AND available_for = 'all' AND ${OWNED_SERVICE}
        ORDER BY sort_order
      `, [organizationId]) as any[];
    }

    const ratePlanId = searchParams.get('ratePlanId') || searchParams.get('ratePlan');
    let includedServices: string[] = [];

    if (ratePlanId) {
      // Scoped too: `code` is unique per property, not per server, and this
      // plan's `included_services_json` sets prices to 0 below. A ratePlan
      // parameter naming a neighbour's plan made services free here.
      const ratePlan = await sql.row<any>(
        `SELECT * FROM rate_plans WHERE (id = ? OR code = ?) AND ${OWNED_SERVICE}`,
        [ratePlanId, ratePlanId, organizationId]) as any;
      if (ratePlan && ratePlan.included_services_json) {
        try {
          includedServices = JSON.parse(ratePlan.included_services_json);
        } catch { /* ignore */ }
      }
    }

    return NextResponse.json({
      services: services.map(s => {
        const formatted = formatService(s);
        // Check if service is included in rate plan
        const isIncluded = includedServices.includes(s.id) || includedServices.includes(s.code || '');
        if (isIncluded) {
          (formatted as any).is_included = true;
          formatted.price = 0;
        }
        return formatted;
      }),
      hasServices: services.length > 0,
    }, { headers: CORS_HEADERS });
  } catch (error: any) {
    console.error('GET /api/booking/services error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to load services' }, { status: 500, headers: CORS_HEADERS });
  }
}

export async function bookWidgetService(request: NextRequest) {
  // Booking a service runs as the hotel that owns the site, exactly like
  // reading the list of services next door. Without this the handler worked on
  // a bare connection: on Postgres every policy compared the tenant with an
  // empty `app.organization_id`, so `additional_services`, `coupons` and
  // `service_time_slots` all came back empty and the guest was told "Service
  // not found" for a service that was right there on the screen. On SQLite,
  // with no policies, it booked — which is why it looked finished.
  //
  // The key is whatever the caller carries: BookingV2 sends siteSlug, the
  // iframe page sends neither and falls back the way the rest of the widget
  // does — the sole organization, or a refusal once there is more than one.
  const body = await request.json().catch(() => ({} as any));
  const siteKey = body?.siteId ?? body?.siteSlug ?? null;

  const answer = await withSite(siteKey, async () => {

    try {
      const sql = getSql();
      const { action } = body;

      // `book-slots` (погодинні слоти сауни/купелі) і `book-breakfast` (меню)
      // вирізано 05.09.2026 (П17) разом із їхніми клієнтами — віджетом і
      // `service-embed.js`: флоу одного клієнта. Лишився перемикач послуги.
      if (action === 'book-toggle') {
        const { serviceId, reservationId, quantity: reqQuantity } = body;

        if (!serviceId || !reservationId) {
          return NextResponse.json({ error: 'serviceId and reservationId required' }, { status: 400, headers: CORS_HEADERS });
        }

        const service = await sql.row<any>('SELECT * FROM additional_services WHERE id = ?', [serviceId]) as any;
        if (!service) {
          return NextResponse.json({ error: 'Service not found' }, { status: 404, headers: CORS_HEADERS });
        }

        const qty = reqQuantity || 1;
        const existingTables = new Set(
          (await sql.rows<any>(sql.dialect.tables()) as { name: string }[])
            .map(t => t.name)
        );

        if (existingTables.has('booking_service_orders')) {
          const existing = await sql.row<any>('SELECT id FROM booking_service_orders WHERE reservation_id = ? AND service_id = ?', [reservationId, serviceId]) as any;

          if (existing) {
            await sql.run('DELETE FROM booking_service_orders WHERE id = ?', [existing.id]);
          } else {
            const orderId = `bso_${Date.now()}_${serviceId}`;
            await sql.run(`
              INSERT INTO booking_service_orders (id, reservation_id, service_id, quantity, unit_price, total_price, status)
              VALUES (?, ?, ?, ?, ?, ?, 'confirmed')
            `, [orderId, reservationId, serviceId, qty, service.price, service.price * qty]);
          }
        }

        return NextResponse.json({ success: true, serviceId, price: service.price }, { status: 201, headers: CORS_HEADERS });
      }

      return NextResponse.json({ error: 'Unknown action' }, { status: 400, headers: CORS_HEADERS });
    } catch (error: any) {
      console.error('POST /api/booking/services error:', error?.message || error);
      return NextResponse.json({ error: 'Failed to process service booking' }, { status: 500, headers: CORS_HEADERS });
    }
  });

  if (answer === null) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404, headers: CORS_HEADERS });
  }
  return answer;
}

function formatService(s: any) {
  return {
    id: s.id,
    name: s.name,
    nameEn: s.name_en,
    nameCs: s.name_cs,
    nameDe: s.name_de,
    description: s.description,
    price: s.price,
    currency: s.currency,
    unitLabel: s.unit_label,
    icon: s.icon,
    category: s.category,
    serviceType: s.service_type || 'simple',
    durationMinutes: s.duration_minutes,
    photoUrl: s.photo_override || s.photo_url,
    minQuantity: s.min_quantity || 0,
    maxQuantity: s.max_quantity || 10,
  };
}
