/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withSite } from '../data/site.repo';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { couponApplies, packageApplies, type Eligibility } from '../domain/coupon-eligibility';

/**
 * Відмова з кодом, а не з реченням: мову тут обирає гість, і рядок складає
 * віджет. `error` лишається як запасний варіант для старого вбудованого
 * бандла, який читає тільки його.
 */
function rejected(e: Extract<Eligibility, { ok: false }>) {
  return { valid: false, reason: e.reason, detail: e.detail, error: 'Coupon code does not apply to this stay' };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function validatePromoOptions() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function validatePromo(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = (searchParams.get('code') || '').toUpperCase().trim();
    const serviceId = searchParams.get('serviceId') || '';
    const unitId = searchParams.get('unitId') || '';
    const siteId = searchParams.get('siteId') || '';
    // Дати поїздки: без них умови купона за ночами й днями заїзду не було чим
    // перевіряти, і вони мовчали. Гість застосовує код і до вибору дат — тоді
    // ці правила пропускають, а вирішує вже бронювання.
    const checkIn = searchParams.get('checkIn') || null;
    const checkOut = searchParams.get('checkOut') || null;
    const nights = checkIn && checkOut
      ? Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400_000)
      : null;

    if (!code) {
      return NextResponse.json({ valid: false, error: 'Code is required' }, { status: 400, headers: CORS_HEADERS });
    }

    // As the hotel the site names: a coupon belongs to one, and under
    // row-level security a guest carries no tenant of its own.
    return (await withSite(siteId, async () => {
    const sql = getSql();
    // Орендар названий і в самому запиті: withSite ставить його для політик
    // Postgres, а на SQLite політик немає — там код чужого готелю відкривав
    // чужий купон.
    const organizationId = await requireOrganizationId();
    let offer = await sql.row<any>(
      'SELECT * FROM coupons WHERE code = ? AND is_active = TRUE AND organization_id = ?',
      [code, organizationId]) as any;
    let isBundle = false;

    if (!offer) {
      offer = await sql.row<any>(
        'SELECT * FROM gift_card_bundles WHERE coupon_code = ? AND is_active = TRUE AND organization_id = ?',
        [code, organizationId]) as any;
      if (offer) isBundle = true;
    }

    if (!offer) {
      return NextResponse.json({ valid: false, error: 'Invalid Coupon code' }, { headers: CORS_HEADERS });
    }

    if (isBundle) {
      if (offer.site_id && offer.site_id !== siteId) {
        return NextResponse.json({ valid: false, error: 'Coupon code not valid for this site' }, { headers: CORS_HEADERS });
      }
      if (offer.redemption_limit !== null && offer.current_uses >= offer.redemption_limit) {
        return NextResponse.json({ valid: false, error: 'Coupon code usage limit reached' }, { headers: CORS_HEADERS });
      }
      // nights_included, дні заїзду і список будиночків — усе в одному місці,
      // тому самому, яке рахує ціну при бронюванні. Раніше тут перевіряли лише
      // список, а кількість ночей взагалі жила у віджеті.
      const fits = packageApplies(offer, { checkIn, nights, unitId: unitId || null });
      if (!fits.ok) return NextResponse.json(rejected(fits), { headers: CORS_HEADERS });

      return NextResponse.json({
        valid: true,
        code: offer.coupon_code,
        discount_type: 'package',
        offer_amount: offer.price,
        description: offer.name,
        bundle: {
          price: offer.price,
          nights_included: offer.nights_included,
          included_services: offer.included_services ? JSON.parse(offer.included_services) : [],
          allowed_days: offer.allowed_days ? JSON.parse(offer.allowed_days) : null,
          applied_listings: offer.applied_listings ? JSON.parse(offer.applied_listings) : [],
          allowed_promo_codes: offer.allowed_promo_codes ? JSON.parse(offer.allowed_promo_codes) : [],
        }
      }, { headers: CORS_HEADERS });
    }

    // Normal Coupon code validation
    const now = new Date().toISOString();
    if (offer.valid_from && now < offer.valid_from) {
      return NextResponse.json({ valid: false, error: 'Coupon code not yet active' }, { headers: CORS_HEADERS });
    }
    if (offer.valid_until && now > offer.valid_until) {
      return NextResponse.json({ valid: false, error: 'Coupon code has expired' }, { headers: CORS_HEADERS });
    }

    if (offer.max_uses !== null && offer.current_uses >= offer.max_uses) {
      return NextResponse.json({ valid: false, error: 'Coupon code usage limit reached' }, { headers: CORS_HEADERS });
    }

    if (offer.site_id && offer.site_id !== siteId) {
      return NextResponse.json({ valid: false, error: 'Coupon code not valid for this site' }, { headers: CORS_HEADERS });
    }

    // «На що діє», списки будиночків і послуг — і, вперше, min_nights,
    // max_nights та allowed_days. Оператор задавав їх у «Промокодах» від
    // самого початку; читав їх досі ніхто.
    const fits = couponApplies(offer, {
      checkIn, nights, unitId: unitId || null, serviceId: serviceId || null,
    });
    if (!fits.ok) return NextResponse.json(rejected(fits), { headers: CORS_HEADERS });

    return NextResponse.json({
      valid: true,
      code: offer.code,
      discount_type: offer.discount_type,
      offer_amount: offer.offer_amount,
      description: offer.description,
    }, { headers: CORS_HEADERS });
    })) ?? NextResponse.json({ valid: false, error: 'Unknown site' }, { status: 404, headers: CORS_HEADERS });

  } catch (error: any) {
    console.error('GET /api/booking/Coupon error:', error?.message || error);
    return NextResponse.json({ valid: false, error: 'Server error' }, { status: 500, headers: CORS_HEADERS });
  }
}
