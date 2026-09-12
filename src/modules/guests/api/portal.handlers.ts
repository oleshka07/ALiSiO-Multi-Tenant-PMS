/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { parseLanguage } from '@core/i18n/languages';
import { readBrandPalette, readBrandLogoUrl } from '@core/brand-palettes';
import * as portalRepo from '../data/guest-portal.repo';
// TODO: replace with @shared/translate when shared module exists
import { extractTexts, extractServiceTexts, getStoredTranslations } from '@core/i18n/translate';
import { translateContent, CONTENT_LANGS } from '@core/i18n/content-translations';
import { sendAbandonNotifications } from './cart.handlers';

export async function getGuestPortal(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  try {
    const { token } = await params;

    const reservation = await portalRepo.getReservationByToken(token);
    if (!reservation) {
      // Tell apart "no such token" from "token exists but refs are broken"
      // so the client can show a useful message and we can find the row in
      // /finance / room-allocation manually.
      const stub = await portalRepo.getReservationStubByToken(token);
      if (stub) {
        console.warn(`[GuestPortal] Token resolves to reservation ${stub.id} but full JOIN failed`);
        return NextResponse.json(
          { error: 'Booking data incomplete', code: 'JOIN_FAILED', reservation_id: stub.id },
          { status: 502 },
        );
      }
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    const now = new Date();
    const checkOut = new Date(reservation.check_out + 'T00:00:00');
    const expiryDate = reservation.guest_page_expires_at
      ? new Date(reservation.guest_page_expires_at)
      : new Date(checkOut.getTime() + 2 * 24 * 60 * 60 * 1000);
    const isExpired = now > expiryDate;

    if (isExpired) {
      const unitTypes = await portalRepo.getUnitTypesForRebooking(reservation.property_id);
      return NextResponse.json({
        expired: true,
        guestName: reservation.first_name,
        brandName: reservation.property_name || '',
        propertyName: reservation.property_name,
        propertyEmail: reservation.property_email,
        propertyPhone: reservation.property_phone,
        unitTypes,
        stayDates: { checkIn: reservation.check_in, checkOut: reservation.check_out },
      });
    }

    const checkIn = new Date(reservation.check_in + 'T00:00:00');
    const today = new Date(now.toISOString().split('T')[0] + 'T00:00:00');
    let phase: 'pre_arrival' | 'checked_in' | 'post_checkout' = 'pre_arrival';
    if (today >= checkIn && today <= checkOut) phase = 'checked_in';
    else if (today > checkOut) phase = 'post_checkout';

    const registeredGuests = await portalRepo.getRegisteredGuests(reservation.id);
    const payments = await portalRepo.getPaymentsSummary(reservation.id);
    const unitTypePhotos = await portalRepo.getUnitTypePhotos(reservation.unit_type_id);
    const propertyPhotos = await portalRepo.getPropertyPhotos(reservation.property_id);
    const services = await portalRepo.getAvailableServices(reservation.property_id, reservation.category_type);
    const orderedServices = await portalRepo.getOrderedServices(reservation.id);
    const guestPageConfig = await portalRepo.getGuestPageConfig(reservation.unit_type_id, reservation.property_id, reservation.unit_id);
    // Which sections this property shows and in what order — the registry
    // with the hotel's differences applied. `locked` never leaves the server
    // for the guest: the guest page only needs what to render.
    const sections = (await portalRepo.getGuestPageSections(reservation.property_id, reservation.property_country))
      .filter((s) => s.enabled)
      .map(({ key, order, config }) => ({ key, order, config }));

    const propertyName = reservation.property_name || '';

    // ── Variant B: send abandon notifications if >30min pending ──────────
    // Fire-and-forget — does not block the page response
    await sendAbandonNotifications(token, propertyName, reservation.organization_id).catch(() => {});

    return NextResponse.json({
      expired: false,
      phase,
      propertyName,
      // The hotel's base language: what the portal opens in before the guest
      // touches the switch. Guessing English served exactly one customer.
      language: parseLanguage(reservation.organization_language),
      reservation,
      registeredGuests,
      payments: {
        totalPaid: payments?.total_paid || 0,
        totalRefunded: payments?.total_refunded || 0,
        remaining: reservation.total_price - (payments?.total_paid || 0) + (payments?.total_refunded || 0),
      },
      photos: { unitType: unitTypePhotos, property: propertyPhotos },
      // Вигляд готелю (0419), уже приведений: сторінка дістає імʼя палітри,
      // яке напевно має блок у таблиці стилів, і адресу, яку напевно можна
      // віддати в `img src`. Приведення тут, а не на екрані: екранів у цієї
      // сторінки шість, і кожен привів би невідоме значення по-своєму.
      brand: {
        palette: readBrandPalette(reservation.brand_palette),
        logoUrl: readBrandLogoUrl(reservation.brand_logo_url),
      },
      sections,
      services,
      orderedServices,
      guestPageConfig,
      translations: await (async () => {
        try {
          const cfgTexts = extractTexts(guestPageConfig || {});
          const svcTexts = extractServiceTexts(services as any[]);
          const allTexts = [...new Set([...cfgTexts, ...svcTexts])];
          const result = await getStoredTranslations(allTexts);
          // Fill any gaps with the static dictionary so the client never falls back to Ukrainian
          // for known standard content, even when OpenAI translations aren't in the DB yet.
          for (const text of allTexts) {
            if (!result[text]) result[text] = {};
            for (const lang of CONTENT_LANGS) {
              if (!result[text][lang]) {
                const staticT = translateContent(text, lang);
                if (staticT !== text) result[text][lang] = staticT;
              }
            }
          }
          return result;
        } catch { return {}; }
      })(),
    });
  } catch (error: any) {
    console.error('GET /api/guest/[token] error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to fetch booking data' }, { status: 500 });
  }
}
