/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { appBaseUrl } from '@core/app-url';
import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import { eventBus } from '@core/event-bus';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { hasFeature, featureDisabled } from '@core/features';
import { withSite } from '../data/site.repo';
import { percentOf } from '@core/money';
import { siteAllowsHost, type SiteRow } from '../data/site.repo';
import { quoteCertificate, claimCertificate } from '../data/certificate.repo';
import { couponApplies, packageApplies } from '../domain/coupon-eligibility';
import { ratePlanNightPrice, ratePlanNamesItsOwnPrice } from '../domain/rate-plan';
import { priceNights } from '@pricing';

// Fallback to guarantee event subscribers are registered in Serverless (Vercel) isolated functions
const ensureSubscribers = async () => {
  if (!(globalThis as any).__prodSubscribersRegistered) {
    try {
      const { registerBookingsSubscribers } = await import('@bookings');
      registerBookingsSubscribers();
      (globalThis as any).__prodSubscribersRegistered = true;
    } catch (e) { console.error('[EventBus] Bootstrap failed', e); }
  }
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Handshake-Token',
};

export async function createWidgetReservationOptions(request: NextRequest) {
  const origin = request.headers.get('origin') || '*';
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'Access-Control-Allow-Origin': origin,
    },
  });
}

export async function createWidgetReservation(request: NextRequest) {
  try {
    await ensureSubscribers();
    const sql = getSql();
    const body = await request.json();

    const siteId = body.siteId;
    const siteSlug = body.siteSlug;

    // The handshake table is created by the boot migration, and is in
    // db/postgres/schema.sql. The "failsafe" that stood here ran on every
    // booking: free on SQLite, refused on Postgres, where the application's
    // role owns nothing and may not create anything.

    // Which hosts this site trusts — its own domain plus allowed_domains.
    let originSite: SiteRow | undefined;
    const searchSite = siteId || siteSlug;
    if (searchSite) {
      originSite = await sql.row<any>("SELECT id, slug, site_url, allowed_domains FROM booking_sites WHERE (id = ? OR slug = ?) AND status != 'deleted'", [searchSite, searchSite]) as SiteRow | undefined;
    }

    const origin = request.headers.get('origin');
    const dynamicHeaders: Record<string, string> = {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Handshake-Token',
    };
    
    if (origin) {
      if (originSite?.site_url) {
        try {
          if (!siteAllowsHost(originSite, new URL(origin).hostname)) {
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

    // Verify and consume handshake token
    if (siteId || siteSlug) {
      const handshakeToken = request.headers.get('x-handshake-token') || body.handshakeToken || '';
      if (!handshakeToken) {
        return NextResponse.json({ error: 'Security handshake token required' }, { status: 403, headers: dynamicHeaders });
      }
      
      const handshake = await sql.row<any>(`
        SELECT token FROM widget_handshakes 
        WHERE token = ? AND expires_at > CURRENT_TIMESTAMP
      `, [handshakeToken]) as { token: string } | undefined;

      if (!handshake) {
        return NextResponse.json({ error: 'Security handshake expired or invalid. Please retry.' }, { status: 403, headers: dynamicHeaders });
      }

      // Single-use token: consume it immediately
      await sql.run('DELETE FROM widget_handshakes WHERE token = ?', [handshakeToken]);
    }

    const {
      unitId, checkIn, checkOut,
      adults = 2, children = 0,
      hasPet = false,
      firstName, lastName, email, phone,
      couponCode, certificateCode, extraCouponCode,
      // Тариф, за яким гість дивився ціну. Віджет пересилає його з URL —
      // раніше він доходив до пошуку й губився дорогою до броні.
      ratePlanId,
      // `currency` з тіла запиту НЕ читається: віджет стоїть на чужій
      // сторінці, і валюта, яку він назве, — це валюта, яку назвав хтось
      // інший. Береться з організації нижче.
      utmParams: rawUtmParams,
      lang: rawLang,
      conversationId,
      // Group booking: how many identical units to reserve
      quantity = 1,
      // Passport / doc data for primary guest — saved as pending registration
      documentType,
      documentNumber,
      dateOfBirth,
      guestCountry,
      // Payment method (cash | terminal) — informational, stored in notes
      paymentMethod,
      documentStrategy, // 'now' | 'portal' | 'reception'
    } = body;

    const lang: string = ['en', 'uk', 'cs', 'de'].includes(rawLang) ? rawLang : 'en';
    const bookingQuantity = Math.max(1, Math.min(Number(quantity) || 1, 20)); // cap at 20

    // Validate & sanitise UTM params — allowlist keys, cap value length
    const ALLOWED_UTM_KEYS = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid','ttclid','ga_client_id'];
    const utmParams: Record<string, string> = {};
    if (rawUtmParams && typeof rawUtmParams === 'object') {
      for (const key of ALLOWED_UTM_KEYS) {
        const val = (rawUtmParams as any)[key];
        if (typeof val === 'string' && val.length > 0 && val.length <= 300) {
          utmParams[key] = val;
        }
      }
    }

    if (!unitId || !checkIn || !checkOut || !firstName || !lastName || !phone) {
      return NextResponse.json({
        error: 'unitId, checkIn, checkOut, firstName, lastName, phone are required',
      }, { status: 400, headers: dynamicHeaders });
    }

    // As the hotel the site names, from here to the end: the unit, the
    // availability, the price and the reservation all belong to one, and a
    // guest carries no tenant of its own. Without this the handler took the
    // caller's word for which unit it was booking.
    return (await withSite(siteId, async () => {

    const ciDate = new Date(checkIn);
    const coDate = new Date(checkOut);
    if (coDate <= ciDate) {
      return NextResponse.json({ error: 'checkOut must be after checkIn' }, { status: 400, headers: CORS_HEADERS });
    }
    const nights = Math.round((coDate.getTime() - ciDate.getTime()) / 86400000);

    const existingTables = new Set(
      (await sql.rows<any>(sql.dialect.tables()) as { name: string }[])
        .map(t => t.name)
    );
    const hasAvailBlocks = existingTables.has('availability_blocks');
    const hasPromotions = existingTables.has('promotions');
    const hasPriceCalendar = existingTables.has('price_calendar');

    const unit = await sql.row<any>(`
      SELECT u.id, u.name, u.code, u.property_id, u.unit_type_id
      FROM units u
      JOIN categories c ON u.category_id = c.id
      JOIN unit_types ut ON ut.id = u.unit_type_id
      -- bookable_online is enforced HERE, not only in the listings: hiding a
      -- room from search means nothing to a request that arrives with the
      -- unit id already in it. «Online nicht buchbar» has to hold against the
      -- request, not against the screen.
      WHERE u.id = ? AND u.is_active = TRUE AND u.room_status = 'available'
        AND ut.bookable_online = TRUE
    `, [unitId]) as any;

    if (unit && siteId && existingTables.has('site_listings')) {
      const allowed = await sql.row<any>('SELECT 1 FROM site_listings WHERE site_id = ? AND unit_id = ?', [siteId, unitId]);
      if (!allowed) {
        // A staging host used to be allowed to book units the site does not
        // list. That was one hotel's deploy preview written into production
        // authorisation — in production the listing decides, full stop.
        if (process.env.NODE_ENV === 'development') {
          console.log(`[DEV BYPASS] Allowing unmapped unit ${unitId} for site ${siteId}`);
        } else {
          return NextResponse.json({ error: 'Unit not available for this site' }, { status: 403, headers: CORS_HEADERS });
        }
      }
    }

    if (!unit) {
      return NextResponse.json({ error: 'Unit not found or not available' }, { status: 404, headers: CORS_HEADERS });
    }

    // Public endpoint: the organization comes from the unit being booked, and
    // it must have bought the widget for this booking to exist at all.
    const unitOrg = await sql.row<any>('SELECT organization_id FROM properties WHERE id = ?', [unit.property_id]) as { organization_id: string } | undefined;
    if (!unitOrg || !await hasFeature(unitOrg.organization_id, 'booking_engine')) {
      return featureDisabled('booking_engine', CORS_HEADERS);
    }

    let priceOverride: number | null = null;
    let thankYouUrl: string | null = null;
    let siteName: string = 'widget';

    if (siteId) {
      if (existingTables.has('booking_sites')) {
        const site = await sql.row<any>('SELECT name FROM booking_sites WHERE id = ?', [siteId]) as any;
        if (site) siteName = `widget:${siteId}`; // unified format: widget:<siteId>
      }
      if (existingTables.has('site_listings')) {
        const listing = await sql.row<any>('SELECT price_override, thank_you_url FROM site_listings WHERE site_id = ? AND unit_id = ?', [siteId, unitId]) as any;
        if (listing) {
          if (listing.price_override != null) priceOverride = listing.price_override;
          if (listing.thank_you_url) thankYouUrl = listing.thank_you_url;
        }
      }
    }

    const isBooked = await sql.row<any>(`
      SELECT 1 FROM reservations r
      WHERE r.unit_id = ?
        AND r.status NOT IN ('cancelled', 'no_show')
        AND r.check_in < ? AND r.check_out > ?
      LIMIT 1
    `, [unitId, checkOut, checkIn]);

    if (isBooked) {
      return NextResponse.json({ error: 'This unit is already booked for the selected dates' }, { status: 409, headers: CORS_HEADERS });
    }

    if (hasAvailBlocks) {
      const isBlocked = await sql.row<any>(`
        SELECT 1 FROM availability_blocks
        WHERE unit_id = ? AND date_from < ? AND date_to > ?
        LIMIT 1
      `, [unitId, checkOut, checkIn]);
      if (isBlocked) {
        return NextResponse.json({ error: 'This unit is blocked for the selected dates' }, { status: 409, headers: CORS_HEADERS });
      }
    }
    // The price of the stay, from the one resolver every caller uses — the
    // occupancy matrix where the owner has priced this category and this many
    // guests, the day calendar otherwise. See pricing/data/nightly-price.ts.
    //
    // What stood here was its own copy of the weekday arithmetic and this line:
    //
    //     let dayPrice = 2500;
    //
    // A night no source could price was billed at 2500 — one customer's number
    // in one customer's currency, charged to whoever booked next. A German
    // hotel would have taken €2500 for a night, quietly, on a guest's card.
    let totalPrice = 0;
    // Валюта броні — валюта готелю, а не те, що прислав браузер.
    //
    // Тут стояло `clientCurrency || 'CZK'`: валюта приходила з ТІЛА запиту
    // (тобто з чужої сторінки, де стоїть віджет), а коли не приходила —
    // підставлялись крони. Німецький готель отримував бронь у кронах, і те
    // саме число потім бачив гість на гостьовій сторінці й у листі
    // підтвердження. Публічний endpoint не має мовчазного дефолту
    // (інваріант 8), а вгадана валюта гірша за відмову — як у
    // `folio.resolveCurrency()`.
    const orgCurrencyRow = await sql.row<any>(
      'SELECT default_currency FROM organizations WHERE id = ?', [unitOrg.organization_id]) as { default_currency?: string } | undefined;
    if (!orgCurrencyRow?.default_currency) {
      console.error(`[widget-reserve] No currency for organization ${unitOrg.organization_id}: set organizations.default_currency`);
      return NextResponse.json({ error: 'Booking is not available right now' }, { status: 500, headers: CORS_HEADERS });
    }
    let resCurrency = String(orgCurrencyRow.default_currency);
    let priced: Awaited<ReturnType<typeof priceNights>> | null = null;

    // Тариф, за яким гість дивився ціну.
    //
    // Раніше цього рядка не було зовсім: `site_rate_plans` читав лише пошук.
    // Гість заходив за посиланням `?ratePlanId=…`, бачив «−20 %» і діставав
    // підтвердження за базовою ціною. Прив'язка до сайту — не формальність:
    // ratePlanId приходить від гостя, і без неї сюди можна було б підставити
    // тариф чужого готелю.
    const ratePlan = ratePlanId
      ? await sql.row<any>('SELECT * FROM site_rate_plans WHERE id = ? AND site_id = ?', [String(ratePlanId), siteId]) as any
      : null;

    if (priceOverride != null) {
      // An operator-set price per night: no source is consulted, and that is
      // the point of an override.
      totalPrice = priceOverride * nights;
    } else if (ratePlanNamesItsOwnPrice(ratePlan)) {
      // Тариф із фіксованою ціною — це і є ціна, названа готелем, тож
      // календар цін тут ні до чого. Саме так рахує пошук.
      totalPrice = ratePlanNightPrice(0, ratePlan) * nights;
    } else {
      priced = hasPriceCalendar
        ? await priceNights({ unitTypeId: unit.unit_type_id, checkIn, nights, persons: adults + children })
        : { nights: [], missing: [checkIn], total: 0, occupancyPriced: false };
      if (priced.missing.length > 0) {
        // Refusing is the only honest answer: the hotel has not said what this
        // night costs, and a booking confirmed at an invented number is a
        // dispute with a guest who did nothing wrong.
        return NextResponse.json(
          { error: 'These dates are not priced yet', missing: priced.missing },
          { status: 409, headers: CORS_HEADERS },
        );
      }
      // Надбавка тарифу — по ночах, тим самим правилом, що й у пошуку. На суму
      // її прикласти не можна: округлення по ночах і округлення суми дають
      // різні числа, а розійтися вони мусять нікуди.
      totalPrice = ratePlan
        ? priced.nights.reduce((sum, n) => sum + ratePlanNightPrice(n.price, ratePlan), 0)
        : priced.total;
    }

    let extraPersonTotal = 0;
    const unitTypeInfo = await sql.row<any>('SELECT base_occupancy, extra_person_charge, pet_allowed, pet_charge FROM unit_types WHERE id = ?', [unit.unit_type_id]) as any;
    // Not when the matrix priced the stay: it already charges by how many
    // people are in the room, and adding the per-extra-guest surcharge on top
    // would bill the third guest twice.
    if (unitTypeInfo && !priced?.occupancyPriced) {
      const baseOcc = unitTypeInfo.base_occupancy || 2;
      const extraGuests = Math.max(0, adults - baseOcc);
      extraPersonTotal = extraGuests * (unitTypeInfo.extra_person_charge || 0) * nights;
      totalPrice += extraPersonTotal;
    }

    let petChargeTotal = 0;
    if (hasPet && unitTypeInfo?.pet_charge) {
      petChargeTotal = unitTypeInfo.pet_charge;
      totalPrice += petChargeTotal;
    }

    let offerDiscount = 0;
    let offer: any = null;
    let isBundle = false;

    if (couponCode) {
      try {
        const code = String(couponCode).toUpperCase().trim();
        offer = await sql.row<any>(`
          SELECT * FROM coupons
          WHERE code = ? AND is_active = TRUE
            AND (valid_from IS NULL OR valid_from <= ?)
            AND (valid_until IS NULL OR valid_until >= ?)
            AND (max_uses IS NULL OR current_uses < max_uses)
        `, [code, checkOut, checkIn]) as any;

        if (!offer) {
          offer = await sql.row<any>(`
            SELECT * FROM gift_card_bundles 
            WHERE coupon_code = ? AND is_active = TRUE 
              AND (redemption_limit IS NULL OR current_uses < redemption_limit)
          `, [code]) as any;
          if (offer) isBundle = true;
        }

        if (offer) {
          // Умови купона перевіряють ТУТ, бо тут вирішують гроші.
          //
          // Раніше їх перевіряв лише `/api/booking/activate` — порада гостю
          // перед бронюванням, — і навіть він читав не всі: min_nights,
          // max_nights і allowed_days не читав ніхто, а nights_included жив у
          // віджеті як умова кнопки. Тобто «пакет на дві ночі за 8500» ставав
          // ціною двадцятиденного заїзду, щойно дати міняли після застосування
          // коду або запит надсилали в обхід віджета. Маршрут публічний.
          //
          // Відмова, а не тиха відсутність знижки: гість бачив на екрані суму
          // зі знижкою, і списати з нього більше без пояснення — гірше, ніж
          // сказати, що код тут не діє, і дати перерахувати.
          const fits = isBundle
            ? packageApplies(offer, { checkIn, nights, unitId })
            : couponApplies(offer, { checkIn, nights, unitId });
          if (!fits.ok) {
            return NextResponse.json(
              { error: 'Coupon code does not apply to this stay', reason: fits.reason, detail: fits.detail },
              { status: 400, headers: CORS_HEADERS });
          }

          if (isBundle) {
            // Package overrides the totalPrice completely
            offerDiscount = Math.max(0, totalPrice - offer.price);
            // Bundle sets its own price and currency
            resCurrency = offer.currency || resCurrency;
            await sql.run('UPDATE gift_card_bundles SET current_uses = current_uses + 1 WHERE id = ?', [offer.id]);
          } else {
            if (offer.discount_type === 'percentage') {
              // Округлення до цілого з'їдало центи знижки: 10 % від 119 € давало
              // 12 € замість 11,90 €, і гість платив на 10 центів менше, ніж каже купон.
              offerDiscount = percentOf(totalPrice, offer.offer_amount);
            } else if (offer.discount_type === 'fixed_price' || offer.discount_type === 'fixed_amount') {
              offerDiscount = Math.max(0, totalPrice - offer.offer_amount);
            } else {
              offerDiscount = offer.offer_amount;
            }
            await sql.run('UPDATE coupons SET current_uses = current_uses + 1 WHERE id = ?', [offer.id]);
          }
        }
      } catch (err: any) { 
        console.error('[Coupon validation error]', err);
      }
    }

    // A fixed-value certificate in the booking's currency is redeemed right
    // here; anything else books at full price with the reason written on the
    // reservation, and the front desk honours it at check-in. One certificate,
    // one booking — group bookings settle certificates at the desk too.
    let certificateDiscount = 0;
    let certificateNote: string | null = null;
    let certificateClaimId: string | null = null;
    if (certificateCode) {
      const remaining = Math.max(0, totalPrice - offerDiscount);
      const answer = bookingQuantity === 1
        ? await quoteCertificate(sql, unitOrg.organization_id, String(certificateCode), remaining, resCurrency)
        : { valid: false as const, message: 'Для групових бронювань сертифікат зараховує рецепція.' };
      if (answer.valid) {
        certificateDiscount = answer.quote.amount;
        certificateClaimId = answer.quote.id;
        certificateNote = `Сертифікат ${answer.quote.code}: зараховано ${answer.quote.amount} ${answer.quote.currency}.`;
      } else {
        certificateNote = `Гість вказав сертифікат ${String(certificateCode).toUpperCase().trim()} — онлайн не зараховано (${answer.message})`;
      }
    }

    let extraDiscount = 0;
    if (extraCouponCode) {
      try {
        const extraCode = String(extraCouponCode).toUpperCase().trim();
        const extraOffer = await sql.row<any>(`
          SELECT * FROM coupons
          WHERE code = ? AND is_active = TRUE
            AND (valid_from IS NULL OR valid_from <= ?)
            AND (valid_until IS NULL OR valid_until >= ?)
            AND (max_uses IS NULL OR current_uses < max_uses)
        `, [extraCode, checkOut, checkIn]) as any;

        if (extraOffer) {
          // Другий код — ті самі умови. Без цього «додатковий промокод» був
          // дірою в тій самій стіні: усе, що заборонено першому, дозволено
          // другому.
          const fitsExtra = couponApplies(extraOffer, { checkIn, nights, unitId });
          if (!fitsExtra.ok) {
            return NextResponse.json(
              { error: 'Coupon code does not apply to this stay', reason: fitsExtra.reason, detail: fitsExtra.detail },
              { status: 400, headers: CORS_HEADERS });
          }

          // Calculate discount based on the price AFTER package/first offer
          const currentPrice = Math.max(0, totalPrice - offerDiscount);
          if (extraOffer.discount_type === 'percentage') {
            extraDiscount = percentOf(currentPrice, extraOffer.offer_amount);
          } else if (extraOffer.discount_type === 'fixed_price' || extraOffer.discount_type === 'fixed_amount') {
            extraDiscount = Math.max(0, currentPrice - extraOffer.offer_amount);
          } else {
            extraDiscount = extraOffer.offer_amount;
          }
          await sql.run('UPDATE coupons SET current_uses = current_uses + 1 WHERE id = ?', [extraOffer.id]);
        }
      } catch (err: any) {
        console.error('[Extra Coupon validation error]', err);
      }
    }

    const finalPrice = Math.max(0, totalPrice - offerDiscount - certificateDiscount - extraDiscount);

    const org = { id: await requireOrganizationId() } as { id: string };

    let guestId: string;
    if (email) {
      const existing = await sql.row<any>('SELECT id FROM guests WHERE email = ? AND organization_id = ?', [email, org.id]) as { id: string } | undefined;

      if (existing) {
        guestId = existing.id;
        await sql.run('UPDATE guests SET first_name = ?, last_name = ?, phone = COALESCE(?, phone), updated_at = CURRENT_TIMESTAMP WHERE id = ?', [firstName, lastName, phone || null, guestId]);
      } else {
        guestId = `g_${Date.now()}`;
        await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name, email, phone) VALUES (?, ?, ?, ?, ?, ?)', [guestId, org.id, firstName, lastName, email, phone || null]);
      }
    } else {
      guestId = `g_${Date.now()}`;
      await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name, phone) VALUES (?, ?, ?, ?, ?)', [guestId, org.id, firstName, lastName, phone || null]);
    }

    const resStatus = finalPrice === 0 ? 'confirmed' : 'tentative';
    const payStatus = finalPrice === 0 ? 'paid' : 'unpaid';

    const utmSource = utmParams['utm_source'] || null;
    const utmMedium = utmParams['utm_medium'] || null;
    const utmCampaign = utmParams['utm_campaign'] || null;
    const utmContent = utmParams['utm_content'] || null;
    const utmTerm = utmParams['utm_term'] || null;
    const gaClientId = utmParams['ga_client_id'] || null;
    const session_id_to_store = body.widget_session_id || body.widgetSessionId || null;
    let countryCode = request.headers.get('cf-ipcountry') || request.headers.get('x-vercel-ip-country') || null;
    if (countryCode && typeof countryCode === 'string') {
      countryCode = countryCode.toUpperCase().slice(0, 2);
    }

    // Тут при quantity > 1 створювався рядок `reservation_groups`, щоб усі
    // броні одного замовлення тримались разом через `group_id`. Групи видалено
    // 2026-08-27 (міграція 0039) — і разом із ними обидва місця, які цей
    // звʼязок ПОКАЗУВАЛИ: список груп на екрані бронювань і `/api/group-bookings`.
    //
    // Тобто запис лишався б записом у колонку, яку більше ніхто не читає.
    // Замовлення на кілька номерів тепер створює кілька окремих броней; кожна
    // зі своїм токеном гостьової сторінки, як і раніше — вони й раніше були
    // окремими рядками, спільним був лише заголовок у таблиці.
    //
    // Наступник для «однієї броні на кілька номерів» у системі вже є —
    // `reservations.parent_id` і `reservation_sub_bookings` (sub-bookings).
    // Віджет на нього НЕ перемикається тут навмисно: sub-booking це не просто
    // спільний id, а дочірня бронь, яка дзеркалить статус і оплату з
    // батьківської, і рішення «замовлення з віджета — це одна бронь на N
    // номерів чи N броней» — продуктове, а не побічний ефект видалення.

    // Helper to generate a unique guest_page_token
    const generateToken = async (): Promise<string> => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const t = Math.random().toString(36).slice(2, 14);
        const existing = await sql.row<any>('SELECT 1 FROM reservations WHERE guest_page_token = ?', [t]);
        if (!existing) return t;
      }
      return `${Math.random().toString(36).slice(2)}_${Date.now()}`;
    };

    const createdReservations: { reservationId: string; guestPageToken: string; unitName: string; slot: number }[] = [];

    for (let slot = 1; slot <= bookingQuantity; slot++) {
      const resId = `r_${Date.now()}_${slot}`;
      const guestPageToken = await generateToken();

      const notesArr = [];
      if (paymentMethod) notesArr.push(`payment_method:${paymentMethod}`);
      if (documentStrategy) notesArr.push(`document_strategy:${documentStrategy}`);
      if (certificateNote) notesArr.push(certificateNote);
      const finalNotes = notesArr.length > 0 ? notesArr.join(' | ') : null;

      await sql.run(`
        -- organization_id, named rather than left to the column DEFAULT: that
        -- DEFAULT is a Postgres mechanism (migration 0005) and on SQLite the
        -- row landed with a NULL tenant. The organization is the one the unit
        -- belongs to, resolved above.
        -- rate_plan_id тут НЕ заповнюється, хоч і напрошується: ця колонка
        -- посилається на rate_plans, а тариф сайту — це інша таблиця,
        -- site_rate_plans. Записати сюди id тарифу сайту означає порушити
        -- зовнішній ключ, тобто 500 на кожну бронь із тарифом (перевірено
        -- живим запитом — саме так і сталося). Щоб бронь пам'ятала, за яким
        -- тарифом сайту її продали, потрібна окрема колонка й міграція; це
        -- рішення про схему, і воно не входить у виправлення ціни.
        INSERT INTO reservations (
          id, organization_id, property_id, unit_id, guest_id, check_in, check_out,
          nights, adults, children, status, payment_status, source,
          total_price, currency, payment_id, promotions_applied, guest_page_token,
          utm_source, utm_medium, utm_campaign, utm_content, utm_term, ga_client_id,
          booking_lang, country_code, widget_session_id, notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [resId, unitOrg.organization_id, unit.property_id, unitId, guestId,
        checkIn, checkOut, nights, adults, children,
        resStatus, payStatus, siteName, finalPrice, resCurrency, null,
        JSON.stringify([couponCode, extraCouponCode].filter(Boolean)),
        guestPageToken,
        utmSource, utmMedium, utmCampaign, utmContent, utmTerm, gaClientId,
        lang, countryCode, session_id_to_store,
        finalNotes]);

      // The certificate is attached to the first reservation, with a status
      // guard against a simultaneous second use. If somebody else claimed it
      // between the quote above and this line, the discount is taken back:
      // the booking survives at full price and the note says why.
      if (slot === 1 && certificateClaimId) {
        if (await claimCertificate(sql, certificateClaimId, resId)) {
          await sql.run("UPDATE gift_cards SET notes = COALESCE(notes, '') || ? WHERE id = ?", [` | widget:${resId}`, certificateClaimId]);
        } else {
          await sql.run(`
            UPDATE reservations
            SET total_price = total_price + ?,
                notes = COALESCE(notes, '') || ?
            WHERE id = ?
          `, [certificateDiscount,
                 ' | Сертифікат не зараховано: використаний іншим бронюванням.', resId]);
          certificateDiscount = 0;
        }
      }

      // Save passport data as a pending guest_registration for the primary guest
      // Staff will confirm/complete at check-in. Only for slot=1 (primary guest).
      if (slot === 1 && documentNumber) {
        try {
          const grId = `gr_${Date.now()}_widget`;
          await sql.run(`
            INSERT INTO guest_registrations
              (id, reservation_id, guest_id, is_primary, reg_status, purpose_of_stay)
            VALUES (?, ?, ?, TRUE, 'pending', 'Tourism')
            ON CONFLICT DO NOTHING
          `, [grId, resId, guestId]);

          // Also enrich the guest record with passport data
          await sql.run(`
            UPDATE guests
            SET document_type    = COALESCE(?, document_type),
                document_number  = COALESCE(?, document_number),
                date_of_birth    = COALESCE(?, date_of_birth),
                country          = COALESCE(?, country),
                updated_at       = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [documentType || null,
            documentNumber || null,
            dateOfBirth   || null,
            guestCountry  || null,
            guestId]);
        } catch (grErr: any) {
          console.error('[Reserve] Failed to save guest_registration draft:', grErr.message);
          // Non-fatal — reservation already created
        }
      }

      // Emit event for CRM and other modules
      await eventBus.emit('booking.created', {
        bookingId: resId,
        guestId,
        unitId,
        total: finalPrice,
        currency: resCurrency,
        source: siteName,
      }).catch(e => console.error('[EventBus] booking.created emit failed:', e));

      createdReservations.push({
        reservationId: resId,
        guestPageToken,
        unitName: unit.name,
        slot,
      });
    }

    // Use first reservation as the primary for emails/notifications
    const primaryRes = createdReservations[0];
    const resId = primaryRes.reservationId;
    const guestPageToken = primaryRes.guestPageToken;

    let testEmailStatus = 'not_sent';
    if (email) {
      try {
        const alisioAppUrl = appBaseUrl();
        const { sendEmail } = await import('@core/mail/email');
        const propertyInfo = await sql.row<any>(`
          SELECT p.name, u.name as unit_name
          FROM units u LEFT JOIN properties p ON u.property_id = p.id
          WHERE u.id = ?
        `, [unitId]) as any;
        const propertyName = propertyInfo?.name || 'ALiSiO';
        const unitName = propertyInfo?.unit_name || '';

        // ── Build primary CTA URL ─────────────────────────────────────
        // The email CTA should always lead to the Guest Portal.
        const guestPortalUrl = `${alisioAppUrl}/guest/${guestPageToken}`;

        let widgetConfig: any = {};
        if (siteId) {
          const siteRow = await sql.row<any>('SELECT widget_config FROM booking_sites WHERE id = ?', [siteId]) as any;
          if (siteRow?.widget_config) {
            try {
              widgetConfig = JSON.parse(siteRow.widget_config);
            } catch { /* */ }
          }
        }

        // ── Localized email defaults ──────────────────────────────────────
        const EMAIL_TEMPLATES: Record<string, any> = {
          en: {
            subject: 'Booking Confirmed — {propertyName}',
            body: 'Thank you for booking with us! Your reservation is confirmed.',
            header: 'Booking Confirmed',
            btnText: 'Guest Portal →',
            docWarning: '⚠️ IMPORTANT: You must complete your online guest registration and provide passport details via the link below before arrival.',
            greeting: 'Hi {firstName}!',
            bookingId: 'Booking ID',
            accommodation: 'Accommodation',
            checkIn: 'Check-in',
            checkOut: 'Check-out',
            nights: 'Nights',
            total: 'Total',
            payment: 'Payment',
            paymentReception: 'Cash/Terminal at Reception',
            paymentOnline: 'Online Paid',
          },
          uk: {
            subject: 'Бронювання підтверджено — {propertyName}',
            body: 'Дякуємо за бронювання! Ваше бронювання підтверджено.',
            header: 'Бронювання підтверджено',
            btnText: 'Особистий кабінет →',
            docWarning: '⚠️ ВАЖЛИВО: До вашого приїзду обов\'язково потрібно заповнити паспортні дані для онлайн-реєстрації за посиланням нижче.',
            greeting: 'Привіт, {firstName}!',
            bookingId: 'Номер броні',
            accommodation: 'Розміщення',
            checkIn: 'Заїзд',
            checkOut: 'Виїзд',
            nights: 'Ночей',
            total: 'Разом',
            payment: 'Оплата',
            paymentReception: 'На місці на рецепції',
            paymentOnline: 'Оплачено онлайн',
          },
          cs: {
            subject: 'Rezervace potvrzena — {propertyName}',
            body: 'Děkujeme za rezervaci! Vaše rezervace je potvrzena.',
            header: 'Rezervace potvrzena',
            btnText: 'Osobní stránka →',
            docWarning: '⚠️ DŮLEŽITÉ: Před příjezdem musíte nutně vyplnit údaje z pasu pro online registraci hostů na odkazu níže.',
            greeting: 'Dobrý den, {firstName}!',
            bookingId: 'Číslo rezervace',
            accommodation: 'Ubytování',
            checkIn: 'Příjezd',
            checkOut: 'Odjezd',
            nights: 'Počet nocí',
            total: 'Celkem',
            payment: 'Platba',
            paymentReception: 'Hotově/kartou na recepci',
            paymentOnline: 'Zaplaceno online',
          },
          de: {
            subject: 'Buchung bestätigt — {propertyName}',
            body: 'Vielen Dank für Ihre Buchung! Ihre Reservierung ist bestätigt.',
            header: 'Buchung bestätigt',
            btnText: 'Persönliche Seite →',
            docWarning: '⚠️ WICHTIG: Sie müssen Ihre Passdaten für die Online-Gästeregistrierung über den unten stehenden Link vor der Anreise zwingend ausfüllen.',
            greeting: 'Hallo {firstName}!',
            bookingId: 'Buchungsnummer',
            accommodation: 'Unterkunft',
            checkIn: 'Check-in',
            checkOut: 'Check-out',
            nights: 'Nächte',
            total: 'Gesamt',
            payment: 'Zahlung',
            paymentReception: 'Bar/Karte an der Rezeption',
            paymentOnline: 'Online bezahlt',
          },
        };
        const emailTpl = EMAIL_TEMPLATES[lang] || EMAIL_TEMPLATES.en;
        
        const needsDocs = !documentNumber;
        const docWarningHtml = needsDocs ? `<div style="background:#fff3cd;border-left:4px solid #ffc107;padding:12px 16px;margin:16px 0;border-radius:0 8px 8px 0;color:#856404;font-size:14px;font-weight:600;line-height:1.5;">${emailTpl.docWarning}</div>` : '';

        const rawSubject = widgetConfig.email_received_subject || emailTpl.subject;
        const rawBody = widgetConfig.email_received_body || emailTpl.body;

        const replaceDict: Record<string, string> = {
          propertyName,
          bookingId: resId,
          guestName: `${firstName || ''} ${lastName || ''}`.trim(),
          firstName: firstName || '',
          lastName: lastName || '',
          checkIn,
          checkOut,
          nights: String(nights),
          totalPrice: `${finalPrice} ${resCurrency}`,
          unitName
        };

        const replacePlaceholders = (tpl: string, dict: Record<string, string>) => {
          let str = tpl;
          for (const [k, v] of Object.entries(dict)) {
            str = str.split(`{${k}}`).join(v);
          }
          return str;
        };

        const customizedSubject = replacePlaceholders(rawSubject, replaceDict);
        const customizedBody = replacePlaceholders(rawBody, replaceDict);

        // Fire-and-forget immediate email sending via standard ALiSiO mail (email.cz)
        // We use import() dynamically so we don't have to await it, preventing UI freezing
        import('@core/mail/email').then(({ sendEmail }) => {
          sendEmail({
            to: email,
            organizationId: unitOrg.organization_id,
            fromName: propertyName || undefined,
            subject: customizedSubject,
            html: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1a1a2e;max-width:600px;margin:0 auto;padding:12px;background:#f7f7f9;">
  <div style="background:#fff;border-radius:12px;padding:24px 20px;box-shadow:0 4px 16px rgba(0,0,0,0.04);">
    <div style="font-size:26px;color:#2E6B4F;font-weight:700;margin-bottom:8px;">${propertyName}</div>
    <div style="font-size:14px;color:#666;margin-bottom:24px;">${emailTpl.header}</div>
    <p style="font-size:16px;margin:0 0 16px;">${emailTpl.greeting.replace('{firstName}', firstName || '')}</p>
    <p style="font-size:15px;line-height:1.5;margin:0 0 20px;">${customizedBody}</p>
    ${docWarningHtml}
    <div style="background:#f0f9f4;border:1px solid #d4e9da;border-radius:12px;padding:16px;margin:20px 0;">
      <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">${emailTpl.bookingId}</div>
      <div style="font-size:20px;font-weight:700;color:#2E6B4F;margin-top:2px;">${resId}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px 0;color:#666;">${emailTpl.accommodation}</td><td style="text-align:right;font-weight:600;">${unitName}</td></tr>
      <tr><td style="padding:8px 0;color:#666;">${emailTpl.checkIn}</td><td style="text-align:right;font-weight:600;">${checkIn}</td></tr>
      <tr><td style="padding:8px 0;color:#666;">${emailTpl.checkOut}</td><td style="text-align:right;font-weight:600;">${checkOut}</td></tr>
      <tr><td style="padding:8px 0;color:#666;">${emailTpl.nights}</td><td style="text-align:right;font-weight:600;">${nights}</td></tr>
      <tr><td style="padding:12px 0 0;color:#2E6B4F;font-size:15px;"><strong>${emailTpl.total}</strong></td><td style="text-align:right;padding:12px 0 0;color:#2E6B4F;font-weight:700;font-size:15px;">${finalPrice} ${resCurrency}</td></tr>
      <tr><td style="padding:8px 0;color:#666;">${emailTpl.payment}</td><td style="text-align:right;font-weight:600;color:${paymentMethod === 'reception' ? '#b45309' : '#2E6B4F'};">${paymentMethod === 'reception' ? emailTpl.paymentReception : emailTpl.paymentOnline}</td></tr>
    </table>
    <div style="margin-top:28px;text-align:center;">
      <a href="${guestPortalUrl}" style="display:inline-block;background:#2E6B4F;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;font-size:15px;">${emailTpl.btnText}</a>
    </div>
  </div>
</body></html>`,
          }).catch(err => console.error('[Widget Reserve] Immediate email failed:', err));
        });
      } catch (err: any) {
        testEmailStatus = `failed: ${err.message}`;
        console.error('[Widget Reserve] Setup failed:', err.message);
      }
    }

    // ── Bundle: pre-create service_orders for included services ──────────
    // Guests schedule the time via their guest portal; staff sees them once scheduled.
    if (isBundle && offer?.included_services) {
      try {
        const bundleServices: Array<{ service_id: string; free?: boolean; isIncluded?: boolean }> =
          typeof offer.included_services === 'string'
            ? JSON.parse(offer.included_services)
            : offer.included_services;

        const bundleNotes = JSON.stringify({ bundle: offer.name || couponCode, included: true });

        for (let i = 0; i < bundleServices.length; i++) {
          const inc = bundleServices[i];
          // Only insert services that are included/free in the bundle
          if (!inc.service_id || (!inc.free && !inc.isIncluded)) continue;
          // Verify the service exists
          const svcExists = await sql.row<any>('SELECT id FROM additional_services WHERE id = ?', [inc.service_id]);
          if (!svcExists) continue;

          await sql.run(`
            INSERT INTO service_orders (id, reservation_id, service_id, quantity, total_price, status, payment_status, service_date, notes)
            VALUES (?, ?, ?, 1, 0, 'confirmed', 'paid', NULL, ?)
          `, [`so_bundle_${Date.now()}_${i}`, resId, inc.service_id, bundleNotes]);
        }
      } catch (bundleErr: any) {
        console.error('[Reserve] Failed to create bundle service_orders:', bundleErr.message);
        // Non-fatal — reservation is already created
      }
    }

    return NextResponse.json({
      success: true,
      // Primary reservation (for backwards compat with old widget)
      reservationId: resId,
      unitName: unit.name,
      checkIn,
      checkOut,
      nights,
      totalPrice: finalPrice,
      originalPrice: totalPrice,
      offerDiscount: offerDiscount + extraDiscount,
      certificateDiscount,
      currency: resCurrency,
      thankYouUrl,
      guestPageToken,
      testEmailStatus,
      // Замовлення на кілька номерів — усі броні зі своїми токенами.
      quantity: bookingQuantity,
      reservations: createdReservations,
    }, { status: 201, headers: dynamicHeaders });

    })) ?? NextResponse.json({ error: 'Unknown site' }, { status: 404, headers: CORS_HEADERS });
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.error('POST /api/booking/reserve error:', msg);
    const clientMsg = process.env.NODE_ENV === 'development'
      ? `Failed to create reservation: ${msg}`
      : 'Failed to create reservation';
    return NextResponse.json({ error: clientMsg }, { status: 500, headers: CORS_HEADERS });
  }
}

export async function getWidgetReservation(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sql = getSql();
    
    const res = await sql.row<any>(`
      SELECT r.id as reservationId, r.check_in as checkIn, r.check_out as checkOut, r.nights, r.total_price as totalPrice, r.currency,
             u.name as unitName
      FROM reservations r
      LEFT JOIN units u ON r.unit_id = u.id
      WHERE r.id = ?
    `, [id]) as any;

    if (!res) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404, headers: CORS_HEADERS });
    }

    return NextResponse.json(res, { headers: CORS_HEADERS });
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: CORS_HEADERS });
  }
}
