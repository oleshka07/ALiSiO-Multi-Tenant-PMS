/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { parseLanguage } from '@core/i18n/languages';
import { readBrandPalette, paletteBackground } from '@core/brand-palettes';
import { logoFor } from '@core/brand-assets';
import { brandAssetsOf } from '@properties/brand-assets';
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
    const payments = await portalRepo.getPaymentsSummary(reservation.id, Number(reservation.total_price || 0));
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

    // Зображення обʼєкта (0421) — через ДВЕРІ модуля, не сирим SQL:
    // `property_brand_assets` належить `modules/properties`, і запит звідси
    // був би пробоєм межі (`check-boundaries`).
    //
    // Свого `runWithOrganization` тут НЕМАЄ, і це перевірено, а не припущено:
    // весь хендлер уже біжить усередині нього — `withGuest` у `api/index.ts`
    // розвʼязує токен і кличе `withGuestReservation`, тобто орендар стоїть на
    // зʼєднанні ще до першого читання. Обгортка тут була б другою відповіддю
    // на те саме питання й казала б наступному читачеві, що контексту немає.
    //
    // Доведено зломом: прибрати обгортку й прогнати сцену на СПРАВЖНЬОМУ
    // Postgres — зелено, бо політиці вже є що звіряти. Гейт, який не вміє
    // почервоніти, нічого не стверджує (AGENTS §3.2).
    const brandAssets = await Promise.resolve(
      brandAssetsOf(String(reservation.organization_id), String(reservation.property_id)),
    ).catch((e) => {
      // Вигляд — прикраса, а не умова: збій тут не має закривати гостю
      // сторінку його броні. У лог, на екран — назва текстом.
      console.error('[GuestPortal] зображення обʼєкта не прочитались', (e as Error)?.message);
      return {};
    });

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
        // Залишок рахує репозиторій: із книги гостя, коли вона є, і з каси
        // проти `total_price`, коли її немає (П4). Тут він лише передається.
        remaining: payments?.remaining ?? 0,
      },
      photos: { unitType: unitTypePhotos, property: propertyPhotos },
      // Вигляд готелю (0419), уже приведений: сторінка дістає імʼя палітри,
      // яке напевно має блок у таблиці стилів, і адресу, яку напевно можна
      // віддати в `img src`. Приведення тут, а не на екрані: екранів у цієї
      // сторінки шість, і кожен привів би невідоме значення по-своєму.
      brand: {
        palette: readBrandPalette(reservation.brand_palette),
        // Лого — з РОЛЬОВОГО рядка (0421), не з `properties.brand_logo_url`:
        // ту колонку міграція перенесла й очистила, тож читач, який на ній
        // лишився, віддає `null` — і сторінка малює назву текстом, тобто
        // виглядає як готель без лого. Нічого не падає; саме тому це
        // стверджує сцена `guest-portal.check`, а не тільки коментар.
        //
        // Тло — з реєстру палітр, одним правилом із застосунком: темний знак
        // на темній шапці зникає, і різницю бачить гість, а не автор.
        logoUrl: logoFor(brandAssets, paletteBackground(reservation.brand_palette)),
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
