/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withSite } from '../data/site.repo';
import { quoteCertificate } from '../data/certificate.repo';
import { priceNights } from '@pricing';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function getAvailabilityOptions() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function getAvailability(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const answer = await withSite(
    searchParams.get('siteSlug') || searchParams.get('siteId'),
    () => availabilityFor(request, searchParams),
  );
  return answer ?? NextResponse.json({ error: 'Unknown site' }, { status: 404, headers: CORS_HEADERS });
}

async function availabilityFor(request: NextRequest, searchParams: URLSearchParams) {
  try {
    const sql = getSql();
    const checkIn = searchParams.get('checkIn');
    const checkOut = searchParams.get('checkOut');
    const couponCode = searchParams.get('couponCode') || '';
    const certificateCode = searchParams.get('certificateCode') || '';
    const ratePlanId = searchParams.get('ratePlanId') || searchParams.get('ratePlan');
    let siteId = searchParams.get('siteId');
    const siteSlug = searchParams.get('siteSlug');
    const categoryType = searchParams.get('type');

    // How many people will sleep in the room. The occupancy matrix prices by
    // this, so it has to travel with the search — the widget does not send it
    // yet, and where it is absent each unit type is priced at its own
    // base_occupancy, which is what "the price of this room" means when nobody
    // has said how many guests.
    const askedAdults = Number(searchParams.get('adults') || 0);
    const askedChildren = Number(searchParams.get('children') || 0);
    const askedPersons = askedAdults + askedChildren;

    const bundleId = searchParams.get('bundleId') || '';

    // Resolve siteId and check origin CORS whitelist
    let siteIdObj = siteId;
    let siteOrganizationId: string | null = null;
    let siteCurrency = 'CZK';
    let allowedSiteUrl: string | null = null;
    const lookupSite = siteId || siteSlug;
    if (lookupSite) {
      const site = await sql.row<any>("SELECT id, organization_id, currency, site_url FROM booking_sites WHERE (slug = ? OR id = ?) AND status != 'deleted'", [lookupSite, lookupSite]) as any;
      siteOrganizationId = site?.organization_id || null;
      siteCurrency = site?.currency || siteCurrency;
      if (site) {
        siteIdObj = site.id;
        allowedSiteUrl = site.site_url;
      }
    }

    const origin = request.headers.get('origin');
    const dynamicHeaders: Record<string, string> = {
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (origin) {
      if (allowedSiteUrl) {
        try {
          const originHost = new URL(origin).hostname;
          const allowedHost = new URL(allowedSiteUrl.startsWith('http') ? allowedSiteUrl : `https://${allowedSiteUrl}`).hostname;
          
          if (
            originHost !== allowedHost && 
            !originHost.endsWith(`.${allowedHost}`) && 
            originHost !== 'localhost' && 
            originHost !== '127.0.0.1'
          ) {
            return NextResponse.json({ error: 'Origin domain not authorized for this widget' }, { status: 403, headers: CORS_HEADERS });
          }
          dynamicHeaders['Access-Control-Allow-Origin'] = origin;
        } catch (e) {
          // ignore malformed URLs
        }
      } else {
        dynamicHeaders['Access-Control-Allow-Origin'] = origin;
      }
    } else {
      dynamicHeaders['Access-Control-Allow-Origin'] = '*';
    }

    let activeRatePlan: any = null;
    let activeBundle: any = null;

    if (siteIdObj) {
      if (ratePlanId) {
        activeRatePlan = await sql.row<any>('SELECT * FROM site_rate_plans WHERE id = ? AND site_id = ?', [ratePlanId, siteIdObj]);
      } else {
        activeRatePlan = await sql.row<any>('SELECT * FROM site_rate_plans WHERE is_default = TRUE AND site_id = ? LIMIT 1', [siteIdObj]);
      }
    }

    if (bundleId) {
      activeBundle = await sql.row<any>('SELECT * FROM gift_card_bundles WHERE id = ? OR coupon_code = ?', [bundleId, bundleId]);
    }


    const hasDates = checkIn && checkOut;
    let ciDate: Date | null = null;
    let coDate: Date | null = null;
    let nights = 0;

    if (hasDates) {
      const [cy, cm, cd] = checkIn!.split('-').map(Number);
      ciDate = new Date(cy, cm - 1, cd);
      const [coy, com, cod] = checkOut!.split('-').map(Number);
      coDate = new Date(coy, com - 1, cod);
      if (coDate <= ciDate) {
        return NextResponse.json({ error: 'checkOut must be after checkIn' }, { status: 400, headers: CORS_HEADERS });
      }
      nights = Math.round((coDate.getTime() - ciDate.getTime()) / 86400000);

      if (activeRatePlan) {
        if (activeRatePlan.min_stay && nights < activeRatePlan.min_stay) {
           return NextResponse.json({ error: `Мінімум ночей: ${activeRatePlan.min_stay}` }, { status: 400, headers: CORS_HEADERS });
        }
        if (activeRatePlan.max_stay && nights > activeRatePlan.max_stay) {
           return NextResponse.json({ error: `Максимум ночей: ${activeRatePlan.max_stay}` }, { status: 400, headers: CORS_HEADERS });
        }

        const today = new Date();
        today.setHours(0,0,0,0);
        const diffDays = Math.round((ciDate.getTime() - today.getTime()) / 86400000);
        
        if (activeRatePlan.min_days_before_checkin != null && activeRatePlan.min_days_before_checkin > 0) {
          if (diffDays < activeRatePlan.min_days_before_checkin) {
             return NextResponse.json({ error: `Бронювання можливе мінімум за ${activeRatePlan.min_days_before_checkin} днів` }, { status: 400, headers: CORS_HEADERS });
          }
        }

        if (diffDays === 0 && activeRatePlan.same_day_cutoff_hour != null) {
          const now = new Date();
          if (now.getHours() >= activeRatePlan.same_day_cutoff_hour) {
             return NextResponse.json({ error: `Бронювання на сьогодні можливе лише до ${activeRatePlan.same_day_cutoff_hour}:00` }, { status: 400, headers: CORS_HEADERS });
          }
        }

        if (activeRatePlan.valid_weekdays) {
          try {
            const allowedDays = JSON.parse(activeRatePlan.valid_weekdays);
            if (Array.isArray(allowedDays) && allowedDays.length > 0) {
              const dayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
              let current = new Date(ciDate);
              for (let i = 0; i < nights; i++) {
                if (!allowedDays.includes(dayMap[current.getDay()])) {
                   return NextResponse.json({ error: `Цей тариф недоступний для обраних днів тижня` }, { status: 400, headers: CORS_HEADERS });
                }
                current.setDate(current.getDate() + 1);
              }
            }
          } catch {}
        }
      }
    }

    const existingTables = new Set(
      (await sql.rows<any>(sql.dialect.tables()) as { name: string }[])
        .map(t => t.name)
    );
    const hasAvailBlocks = existingTables.has('availability_blocks');
    const hasPromotions = existingTables.has('promotions');
    const hasPriceCalendar = existingTables.has('price_calendar');

    const units = await sql.rows<any>(`
      SELECT u.id, u.name, u.code, u.beds, u.room_status, u.is_active,
             ut.id as unit_type_id, ut.name as type_name, ut.code as type_code,
             ut.photos as type_photos,
             ut.description as type_description,
             ut.max_adults, ut.max_children, ut.max_occupancy,
             ut.base_occupancy, ut.beds_single, ut.beds_double, ut.beds_sofa,
             ut.extra_person_charge, ut.pet_allowed, ut.pet_charge,
             c.id as category_id, c.name as category_name, c.type as category_type,
             c.icon as category_icon, c.color as category_color, c.sort_order as category_sort,
             MAX(gpc.amenities) as gpc_amenities,
             MAX(sl.photos) as listing_photos,
             MAX(sl.price_override) as price_override
      FROM units u
      JOIN unit_types ut ON u.unit_type_id = ut.id
      JOIN categories c ON u.category_id = c.id
      LEFT JOIN guest_page_config gpc ON gpc.unit_type_id = ut.id
      LEFT JOIN site_listings sl ON (sl.unit_id = u.id OR (sl.unit_type_id = ut.id AND sl.unit_id IS NULL))
        ${siteIdObj ? 'AND sl.site_id = ?' : ''}
      WHERE u.is_active = TRUE
        AND u.room_status = 'available'
        ${categoryType ? 'AND c.type = ?' : ''}
      GROUP BY u.id, u.name, u.code, u.beds, u.room_status, u.is_active,
               ut.id, ut.name, ut.code, ut.photos, ut.description,
               ut.max_adults, ut.max_children, ut.max_occupancy,
               ut.base_occupancy, ut.beds_single, ut.beds_double, ut.beds_sofa,
               ut.extra_person_charge, ut.pet_allowed, ut.pet_charge,
               c.id, c.name, c.type, c.icon, c.color, c.sort_order
      ORDER BY u.sort_order, u.name
    `, [...[
      ...(siteIdObj ? [siteIdObj] : []),
      ...(categoryType ? [categoryType] : [])
    ]]) as any[];

    const results = [];

    for (const unit of units) {
      if (hasDates) {
        const isBooked = await sql.row<any>(`
          SELECT 1 FROM reservations r
          WHERE r.unit_id = ?
            AND r.status NOT IN ('cancelled', 'no_show')
            AND r.check_in < ? AND r.check_out > ?
          LIMIT 1
        `, [unit.id, checkOut, checkIn]);

        if (isBooked) continue;

        if (hasAvailBlocks) {
          const isBlocked = await sql.row<any>(`
            SELECT 1 FROM availability_blocks
            WHERE unit_id = ?
              AND date_from < ? AND date_to > ?
            LIMIT 1
          `, [unit.id, checkOut, checkIn]);
          if (isBlocked) continue;
        }
      }

      const dayNames = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
      const breakdown: { date: string; dayName: string; price: number; isWeekend: boolean }[] = [];
      let totalPrice = 0;
      let hasPricing = false;

      if (hasDates && ciDate) {
        if (activeBundle && activeBundle.is_active) {
          // Bundle logic: fixed total price divided by nights
          const bundlePricePerNight = nights > 0 ? activeBundle.price / activeBundle.nights_included : activeBundle.price;
          const current = new Date(ciDate);
          for (let i = 0; i < nights; i++) {
            const dateStr = current.toISOString().split('T')[0];
            const dayOfWeek = current.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
            const dayPrice = bundlePricePerNight;
            hasPricing = true;
            breakdown.push({ date: dateStr, dayName: dayNames[dayOfWeek], price: dayPrice, isWeekend });
            totalPrice += dayPrice;
            current.setDate(current.getDate() + 1);
          }
        } else if (activeRatePlan && activeRatePlan.fixed_price != null) {
          // VIP Tariff: use fixed price for all days
          const current = new Date(ciDate);
          for (let i = 0; i < nights; i++) {
            const dateStr = current.toISOString().split('T')[0];
            const dayOfWeek = current.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
            const dayPrice = activeRatePlan.fixed_price;
            hasPricing = true;
            breakdown.push({ date: dateStr, dayName: dayNames[dayOfWeek], price: dayPrice, isWeekend });
            totalPrice += dayPrice;
            current.setDate(current.getDate() + 1);
          }
        } else {
          // The same resolver the reservation endpoint uses, so what the guest
          // is shown in the search results is what they will be charged. This
          // block used to hold its own copy of the weekday arithmetic and the
          // same `let dayPrice = 2500` — one customer's number, shown to every
          // guest of every hotel whenever a night had no price.
          const priced = hasPriceCalendar
            ? await priceNights({
              unitTypeId: unit.unit_type_id, checkIn, nights,
              persons: askedPersons > 0 ? askedPersons : (Number(unit.base_occupancy) || 2),
            })
            : null;
          const byDate = new Map((priced?.nights ?? []).map((n) => [n.date, n]));

          const current = new Date(ciDate);
          for (let i = 0; i < nights; i++) {
            const dateStr = current.toISOString().split('T')[0];
            const dayOfWeek = current.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
            const night = byDate.get(dateStr);

            // A night nobody has priced stays at zero and leaves hasPricing
            // false, which is how this unit is shown as not bookable rather
            // than offered at an invented figure.
            let dayPrice = 0;
            if (unit.price_override != null) {
              dayPrice = unit.price_override;
              hasPricing = true;
            } else if (night) {
              dayPrice = night.price;
              hasPricing = true;
            }

            if (activeRatePlan && activeRatePlan.pricing_mode === 'dependent' && activeRatePlan.pricing_modifier_percent != null) {
              const pct = activeRatePlan.pricing_modifier_percent;
              const mType = activeRatePlan.pricing_modifier_type || 'less';
              if (mType === 'more') {
                dayPrice = Math.round(dayPrice * (1 + pct / 100));
              } else {
                dayPrice = Math.round(dayPrice * (1 - pct / 100));
              }
            }

            breakdown.push({ date: dateStr, dayName: dayNames[dayOfWeek], price: dayPrice, isWeekend });
            totalPrice += dayPrice;
            current.setDate(current.getDate() + 1);
          }
        }
      }

      const avgPricePerNight = nights > 0 ? Math.round(totalPrice / nights) : 0;

      let isAllowedByBundle = true;
      if (activeBundle && activeBundle.applied_listings) {
        try {
          const applied = JSON.parse(activeBundle.applied_listings);
          if (Array.isArray(applied) && applied.length > 0) {
            if (!applied.includes(unit.id) && !applied.includes(unit.unit_type_id)) isAllowedByBundle = false;
          }
        } catch {}
      }
      if (!isAllowedByBundle) continue;

      results.push({
        id: unit.id,
        name: unit.name,
        code: unit.code,
        beds: unit.beds,
        unitTypeId: unit.unit_type_id,
        typeName: unit.type_name,
        typeCode: unit.type_code,
        // The widget groups by category when a property has more than one, so
        // guests pick "Glamping" or "Rooms" before browsing individual units.
        // These were already joined for filtering but never returned.
        categoryId: unit.category_id,
        categoryName: unit.category_name,
        categoryType: unit.category_type,
        categoryIcon: unit.category_icon,
        categoryColor: unit.category_color,
        categorySort: unit.category_sort ?? 0,
        description: unit.type_description,
        maxAdults: unit.max_adults,
        maxChildren: unit.max_children,
        maxOccupancy: unit.max_occupancy,
        baseOccupancy: unit.base_occupancy,
        bedsSingle: unit.beds_single,
        bedsDouble: unit.beds_double,
        bedsSofa: unit.beds_sofa,
        hasPricing,
        avgPricePerNight,
        totalPrice,
        breakdown,
        currency: 'CZK',
        extraPersonCharge: unit.extra_person_charge || 1000,
        petAllowed: unit.pet_allowed !== 0,
        petCharge: unit.pet_charge || 400,
        photos: (() => {
          const photoStr = unit.listing_photos || unit.type_photos || '';
          return photoStr ? photoStr.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
        })(),
        amenities: (() => { try { return JSON.parse(unit.gpc_amenities || '[]'); } catch { return []; } })(),
      });
    }

    let offerDiscount: { name: string; discountType: string; offerAmount: number; finalDiscount: number } | null = null;
    if (couponCode && hasPromotions) {
      const offer = await sql.row<any>(`
        SELECT * FROM promotions
        WHERE coupon_code = ? AND is_active = TRUE
          AND (date_from IS NULL OR date_from <= ?)
          AND (date_to IS NULL OR date_to >= ?)
          AND (usage_limit IS NULL OR usage_count < usage_limit)
      `, [couponCode, checkOut, checkIn]) as any;

      if (offer) {
        offerDiscount = {
          name: offer.name,
          discountType: offer.discount_type,
          offerAmount: offer.offer_amount,
          finalDiscount: 0,
        };
      }
    }

    // The certificate answer the guest sees while choosing dates. Amount here
    // is the face value — the reserve endpoint caps it at the actual total and
    // makes the atomic claim; this is a preview, not a promise.
    let certificate: { code: string; amount: number; valid: boolean; message?: string } | null = null;
    if (certificateCode) {
      if (siteOrganizationId) {
        const answer = await quoteCertificate(sql, siteOrganizationId, certificateCode, Number.MAX_SAFE_INTEGER, siteCurrency);
        certificate = answer.valid
          ? { code: certificateCode, amount: answer.quote.amount, valid: true }
          : { code: certificateCode, amount: 0, valid: false, message: answer.message };
      } else {
        certificate = {
          code: certificateCode, amount: 0, valid: false,
          message: 'Сертифікат перевіримо на рецепції.',
        };
      }
    }

    return NextResponse.json({
      checkIn,
      checkOut,
      nights,
      units: results,
      offerDiscount,
      certificate,
      activeRatePlan: activeRatePlan ? {
        id: activeRatePlan.id,
        code: activeRatePlan.code,
        name: activeRatePlan.name,
        includedServices: (() => {
          try { return JSON.parse(activeRatePlan.included_services_json || '[]'); } catch { return []; }
        })()
      } : null,
    }, { headers: dynamicHeaders });
  } catch (error: any) {
    console.error('GET /api/booking/availability error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to check availability' }, { status: 500, headers: CORS_HEADERS });
  }
}
