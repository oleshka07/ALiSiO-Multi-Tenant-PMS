/**
 * Що термінал робить із перебуванням: знайти, зареєструвати, заселити, виселити.
 *
 * Усі маршрути безсесійні, усі за токеном пристрою (`requireDevice`), усі —
 * лише через фасади частини А. Свого SQL у ядро тут немає: кіоск читає
 * `stay.repo.ts` (свої запити з віссю будинку) і ПИШЕ тільки фасадами
 * `@bookings` / `@guests`.
 *
 * ── Що віддається на екран, а що ні ─────────────────────────────────────
 *
 * Екран стоїть у холі, і його читає будь-хто, хто пройде повз. Тому:
 *
 *   імена       — маскою (`Herr M…`), і повне не їде навіть у полі, якого
 *                 не показують: те, що приїхало в браузер, уже видно;
 *   документи   — ЖОДНОГО номера документа, ніде;
 *   код скриньки — лише на своєму кроці, після заселення, і лише для
 *                 призначеного номера цієї броні (`lockCodeForStay`);
 *   чужі броні  — ніколи: список збігів не показується, вимагається третій
 *                 чинник.
 *
 * ── Подія на кожну дію ──────────────────────────────────────────────────
 *
 * `kiosk_events` пишеться і на успіх, і на відмову: «шукав і не знайшов»
 * тридцять разів за вечір означає, що екран не працює, і без такого рядка це
 * видно лише зі скарги гостя. Ідемпотентність — властивість самої події:
 * друге «заселити» на вже заселеній броні події НЕ пише, бо нічого не
 * сталося (§3.4).
 */
import { NextResponse } from 'next/server';
import { runWithOrganization } from '@core/auth/tenant-context';
import { handleError, refuse } from '@core/http/errors';
import { checkIn, checkOut, assignUnit, readSystemOfRecord } from '@bookings/kernel';
import { saveSignature, isSigned, saveRegistrations } from '@guests/kernel';
import { lockCodeForStay } from '@properties/kernel';
import { reservationFolioSummary } from '@invoicing/kernel';
import { getSql } from '@core/db/async';
import { todayIn } from '@core/hotel-day';
import { requireDevice } from './session.handlers';
import { noteEvent } from '../data/devices.repo';
import { findStays, propertyGuestConfig, stayById, stayGuests } from '../data/stay.repo';
import {
  decideSearch, enoughFactors, maskName, namedFactors, readAutoAssign, readSignatureMode,
  readTime, signatureNeeded, stayWindow, tooEarly, type SearchInput,
} from '../domain/search';
import type { KioskDevice } from '../data/device-token';

/** Сьогодні за календарем сервера, `YYYY-MM-DD`. */
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Перебування у формі, придатній для екрана в холі: без прізвищ, без
 * документів, без чужого. Одне місце, а не `...row` у кожному хендлері —
 * інакше наступне поле поїде на екран разом із наступною правкою.
 */
function forScreen(row: {
  id: string; check_in: string; check_out: string; nights: number; adults: number; children: number;
  status: string; payment_status: string; registration_status: string | null;
  unit_name: string | null; unit_type_name: string | null; first_name: string | null; last_name: string | null;
}) {
  return {
    reservationId: row.id,
    guest: `${maskName(row.first_name)} ${maskName(row.last_name)}`.trim(),
    checkIn: row.check_in.slice(0, 10),
    checkOut: row.check_out.slice(0, 10),
    nights: Number(row.nights) || 0,
    adults: Number(row.adults) || 0,
    children: Number(row.children) || 0,
    status: row.status,
    paymentStatus: row.payment_status,
    registered: row.registration_status === 'registered',
    unitName: row.unit_name,
    unitTypeName: row.unit_type_name,
  };
}

/**
 * Відмова фасаду → відповідь клієнту, статус ЛІТЕРАЛОМ у кожній гілці.
 *
 * `refuse(msg, status)` зі змінною гейт `check-refusal-status` прочитати не
 * може: він читає ЧИСЛО, а не тип, і тернарник у виклику для нього — «статус
 * невідомий». Урок той самий, що в `winhotel-import` (`refuseReported`), і
 * він не формальний: саме так «названа відмова» одного разу поїхала 500-кою.
 *
 * Рід відмови вирішує число: «немає такого» — 404 (інваріант 5), «зайнято /
 * нема чого дати» — 409, «правило не пускає» — 422.
 */
function refuseFacade(code: string, kind: 'checkin' | 'assign' | 'sign' | 'checkout'): never {
  if (code === 'not_found') refuse('not_found', 404);
  if (kind === 'assign') refuse(code, 409);
  if (kind === 'sign') refuse(code, 400);
  refuse(code, 422);
}

/** Тіло запиту як обʼєкт; кривий JSON — порожньо, а не 500. */
async function body(request: Request): Promise<Record<string, unknown>> {
  return (await request.json().catch(() => ({}))) as Record<string, unknown>;
}

/** `POST /api/apps/kiosk/find` — пошук броні. */
export async function findStay(request: Request): Promise<Response> {
  try {
    const device = await requireDevice(request);
    const raw = await body(request);
    const search: SearchInput = {
      token: raw.token as string, lastName: raw.lastName as string,
      checkIn: raw.checkIn as string, confirmation: raw.confirmation as string,
      phone: raw.phone as string, email: raw.email as string,
    };

    const factors = namedFactors(search);
    if (!enoughFactors(factors)) {
      // 400, а не «не знайдено»: гість мусить дізнатись, що ввів замало, —
      // це не відповідь про чужу бронь, а про його власний ввід.
      refuse('need_factors', 400);
    }

    return await runWithOrganization(device.organizationId, async () => {
      const rows = await findStays({
        organizationId: device.organizationId, propertyId: device.propertyId,
        search, window: stayWindow(today()),
      });
      const outcome = decideSearch(rows);

      if (outcome.kind === 'found') {
        const row = rows[0];
        await noteEvent({
          organizationId: device.organizationId, deviceId: device.id,
          reservationId: row.id, kind: 'search', result: 'ok',
        });
        return NextResponse.json({ found: true, stay: forScreen(row) });
      }
      // Скільки саме збігів — не кажеться: «їх троє» це вже відповідь про
      // те, скільки Мюллерів живе в готелі.
      await noteEvent({
        organizationId: device.organizationId, deviceId: device.id,
        kind: outcome.kind === 'need_more' ? 'search_ambiguous' : 'search_miss',
        result: 'refused', detail: factors.join('+'),
      });
      return NextResponse.json({ found: false, reason: outcome.kind });
    });
  } catch (error) {
    return handleError('apps/kiosk findStay', error, 'Не вдалося виконати пошук');
  }
}

/**
 * Перебування, знайдене раніше, — за id.
 *
 * Id сам по собі НЕ перепустка: він міг би прийти з чужого екрана. Тому
 * читання те саме, що в пошуку, — з орендарем, будинком і вікном: бронь поза
 * вікном не існує для термінала, навіть коли її id відомий.
 */
async function requireStay(device: KioskDevice, reservationId: string) {
  const row = await stayById({
    organizationId: device.organizationId, propertyId: device.propertyId, reservationId,
  });
  if (!row) refuse('Не знайдено', 404);
  const { from, to } = stayWindow(today());
  const ci = row.check_in.slice(0, 10);
  const co = row.check_out.slice(0, 10);
  const inside = (ci >= from && ci <= to) || (co >= from && co <= to) || (ci < from && co > to);
  if (!inside) refuse('Не знайдено', 404);
  return row;
}

/** `POST /api/apps/kiosk/stay` — картка перебування з гостями. */
export async function stayCard(request: Request): Promise<Response> {
  try {
    const device = await requireDevice(request);
    const raw = await body(request);
    const reservationId = String(raw.reservationId ?? '');
    return await runWithOrganization(device.organizationId, async () => {
      const row = await requireStay(device, reservationId);
      const guests = await stayGuests({
        organizationId: device.organizationId, propertyId: device.propertyId, reservationId,
      });
      const signed = await isSigned(device.organizationId, device.propertyId, reservationId);
      const home = await getSql().row<{
        country: string | null; kiosk_signature: string | null;
        kiosk_earliest_checkin: string | null; kiosk_auto_assign: unknown;
      }>(`SELECT country, kiosk_signature, kiosk_earliest_checkin, kiosk_auto_assign
            FROM properties WHERE id = ? AND organization_id = ?`,
        [device.propertyId, device.organizationId]);
      return NextResponse.json({
        stay: forScreen(row),
        // Номерів документів немає — лише ознака «документ уже є».
        guests: guests.map((g) => ({
          name: `${maskName(g.first_name)} ${maskName(g.last_name)}`.trim(),
          nationality: g.nationality,
          hasDocument: !!g.document_type,
        })),
        // Meldeschein і підпис — лише іноземцям (КІ3). Громадянство береться
        // з першого гостя або з профілю броні; порожнє означає «ще не
        // назвався», і тоді підпис вимагається — бо доки не знаємо, ми не
        // маємо права вирішити, що він не потрібен (інваріант 13).
        // Підпис — за політикою ОБʼЄКТА поверх громадянства (0413): дефолт
        // `foreigners` це і є КІ3, `never` знімає Meldeschein там, де його
        // немає в законі, `always` — внутрішнє правило готелю.
        signatureNeeded: signatureNeeded(
          readSignatureMode(home?.kiosk_signature),
          isDomestic(guests[0]?.nationality ?? row.guest_country, home?.country),
        ),
        // Година, раніше за яку термінал не селить. Порожньо = обмеження
        // немає; екран показує її гостю, а не мовчки відмовляє.
        earliestCheckIn: readTime(home?.kiosk_earliest_checkin),
        signed,
        // QR веде на гостьовий портал, де вже є OCR документа зі згодою.
        // Порожньо, поки токена немає: він зʼявляється при заселенні.
        documentQrPath: row.guest_page_token ? `/guest/${row.guest_page_token}` : null,
      });
    });
  } catch (error) {
    return handleError('apps/kiosk stayCard', error, 'Не вдалося прочитати бронь');
  }
}

/**
 * Громадянин країни ОБʼЄКТА — той, кому Meldeschein не потрібен (КІ3).
 *
 * Порівнюється з країною БУДИНКУ, а не з літералом «DE»: назва юрисдикції в
 * коді — це те, від чого застерігає інваріант 22, і готель в Австрії читав би
 * тут чужий закон.
 *
 * Чиста функція, і країна приходить аргументом — не з модульної змінної.
 * Перша редакція тримала її в кеші поруч (`let cache = …`), і це був би
 * глобальний стан у багатоорендному сервері: два готелі в одному процесі,
 * і другий читає країну першого. Тут це вирішувало б, чи вимагати підпис.
 *
 * Порожнє громадянство або порожня країна будинку → `false`, тобто підпис
 * ВИМАГАЄТЬСЯ: доки ми не знаємо, ми не маємо права вирішити, що він не
 * потрібен (інваріант 13).
 */
export function isDomestic(nationality: string | null | undefined, propertyCountry: string | null | undefined): boolean {
  const n = String(nationality ?? '').trim().toUpperCase();
  const home = String(propertyCountry ?? '').trim().toUpperCase();
  if (!n || !home) return false;
  return n === home;
}

/** `POST /api/apps/kiosk/register` — картки гостей у книгу. */
export async function registerStay(request: Request): Promise<Response> {
  try {
    const device = await requireDevice(request);
    const raw = await body(request);
    const reservationId = String(raw.reservationId ?? '');
    const guests = Array.isArray(raw.guests) ? raw.guests : [];
    if (guests.length === 0) refuse('Назвіть хоча б одного гостя', 400);

    return await runWithOrganization(device.organizationId, async () => {
      await requireStay(device, reservationId);
      // Двері `@guests` — ті самі, якими пише портал і рецепція. Свого
      // писача в `reservation_guests` кіоск не має.
      await saveRegistrations(reservationId, device.organizationId, guests as any);
      await noteEvent({
        organizationId: device.organizationId, deviceId: device.id,
        reservationId, kind: 'register', result: 'ok', detail: String(guests.length),
      });
      return NextResponse.json({ ok: true, count: guests.length });
    });
  } catch (error) {
    return handleError('apps/kiosk registerStay', error, 'Не вдалося зберегти реєстрацію');
  }
}

/** `POST /api/apps/kiosk/sign` — підпис пальцем під реєстрацією (КІ3). */
export async function signStay(request: Request): Promise<Response> {
  try {
    const device = await requireDevice(request);
    const raw = await body(request);
    const reservationId = String(raw.reservationId ?? '');
    return await runWithOrganization(device.organizationId, async () => {
      await requireStay(device, reservationId);
      const done = await saveSignature({
        organizationId: device.organizationId, propertyId: device.propertyId,
        reservationId, signaturePng: String(raw.signaturePng ?? ''),
      });
      if (!done.ok) {
        await noteEvent({
          organizationId: device.organizationId, deviceId: device.id,
          reservationId, kind: 'sign', result: 'refused', detail: done.refusal,
        });
        refuseFacade(done.refusal, 'sign');
      }
      await noteEvent({
        organizationId: device.organizationId, deviceId: device.id,
        reservationId, kind: 'sign', result: 'ok',
      });
      return NextResponse.json({ ok: true });
    });
  } catch (error) {
    return handleError('apps/kiosk signStay', error, 'Не вдалося зберегти підпис');
  }
}

/**
 * `POST /api/apps/kiosk/checkin` — заселити.
 *
 * `assignUnit` (якщо номера немає) → `checkIn` → номер, код скриньки, Wi-Fi.
 * Обидва — фасади частини А; своєї варти тут немає й бути не може.
 *
 * Ідемпотентно: бронь уже заселена → та сама відповідь, і події НЕ пишеться.
 * Подія означає «сталося», а вдруге не сталося нічого (§3.4).
 */
export async function checkInStay(request: Request): Promise<Response> {
  try {
    const device = await requireDevice(request);
    const raw = await body(request);
    const reservationId = String(raw.reservationId ?? '');
    return await runWithOrganization(device.organizationId, async () => {
      const before = await requireStay(device, reservationId);
      const already = before.status === 'checked_in';
      const actor = {
        kind: 'device' as const, organizationId: device.organizationId,
        propertyId: device.propertyId, userId: null,
      };

      const policy = await getSql().row<{
        kiosk_auto_assign: unknown; kiosk_earliest_checkin: string | null; timezone?: string | null;
      }>(`SELECT p.kiosk_auto_assign, p.kiosk_earliest_checkin, o.timezone
            FROM properties p JOIN organizations o ON o.id = p.organization_id
           WHERE p.id = ? AND p.organization_id = ?`,
        [device.propertyId, device.organizationId]);
      // Обʼєкта немає — політик немає — заселяти нікуди (інваріант 13).
      if (!policy) refuse('Не знайдено', 404);

      // Зарано — це відмова гостю з ГОДИНОЮ, а не мовчазне «спробуйте пізніше».
      // Питання лише про заїзд СЬОГОДНІ: хто приїхав учора, давно всередині.
      const nowHm = new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: policy.timezone || 'UTC',
      });
      const earliest = readTime(policy.kiosk_earliest_checkin);
      if (!already && before.check_in.slice(0, 10) === todayIn(policy.timezone)
          && tooEarly(nowHm, earliest)) {
        await noteEvent({
          organizationId: device.organizationId, deviceId: device.id,
          reservationId, kind: 'checkin', result: 'refused', detail: `too_early:${earliest}`,
        });
        return NextResponse.json({ error: 'too_early', earliestCheckIn: earliest }, { status: 409 });
      }

      if (!before.unit_id && !readAutoAssign(policy.kiosk_auto_assign)) {
        // Готель розподіляє номери руками: термінал не обирає кімнату, він
        // веде гостя до рецепції. Це не поломка — це рішення готелю.
        await noteEvent({
          organizationId: device.organizationId, deviceId: device.id,
          reservationId, kind: 'checkin', result: 'refused', detail: 'no_auto_assign',
        });
        refuse('no_unit', 409);
      }

      if (!before.unit_id) {
        const assigned = await assignUnit(reservationId, { actor, prefer: 'clean' });
        if (!assigned.ok) {
          await noteEvent({
            organizationId: device.organizationId, deviceId: device.id,
            reservationId, kind: 'checkin', result: 'refused', detail: assigned.refusal,
          });
          refuseFacade(assigned.refusal, 'assign');
        }
      }

      const done = await checkIn(reservationId, { actor });
      if (!done.ok) {
        await noteEvent({
          organizationId: device.organizationId, deviceId: device.id,
          reservationId, kind: 'checkin', result: 'refused', detail: done.refusal,
        });
        refuseFacade(done.refusal, 'checkin');
      }
      if (!already) {
        await noteEvent({
          organizationId: device.organizationId, deviceId: device.id,
          reservationId, kind: 'checkin', result: 'ok',
        });
      }

      const key = await lockCodeForStay({
        organizationId: device.organizationId, propertyId: device.propertyId, reservationId,
      });
      const cfg = await propertyGuestConfig(device.organizationId, device.propertyId);
      return NextResponse.json({
        ok: true,
        unitName: key?.unitName ?? null,
        lockCode: key?.lockCode ?? null,
        wifi: cfg?.wifi_network ? { network: cfg.wifi_network, password: cfg.wifi_password } : null,
      });
    });
  } catch (error) {
    return handleError('apps/kiosk checkInStay', error, 'Не вдалося заселити');
  }
}

/**
 * `POST /api/apps/kiosk/checkout` — виселити.
 *
 * Фоліо → борг → `checkOut` → що піде листом. Фактуру кіоск НЕ виставляє сам:
 * у фазі `alisio` це робить `@invoicing` за нашою нумерацією, у фазі
 * `external` головна книга чужа, і документ звідти — тож замість номера йде
 * підсумок перебування, а в журнал доби лягає рядок «виставити фактуру у
 * чужій системі», який рецепція бачить на екрані «Kiosk heute» (частина В).
 */
export async function checkOutStay(request: Request): Promise<Response> {
  try {
    const device = await requireDevice(request);
    const raw = await body(request);
    const reservationId = String(raw.reservationId ?? '');
    return await runWithOrganization(device.organizationId, async () => {
      await requireStay(device, reservationId);
      const property = await getSql().row<{ system_of_record: string | null }>(
        'SELECT system_of_record FROM properties WHERE id = ? AND organization_id = ?',
        [device.propertyId, device.organizationId]);
      // Обʼєкта немає — фази немає — виселяти нікуди (інваріант 13).
      if (!property) refuse('Не знайдено', 404);
      const phase = readSystemOfRecord(property.system_of_record);

      const folio = await reservationFolioSummary(reservationId);
      const actor = {
        kind: 'device' as const, organizationId: device.organizationId,
        propertyId: device.propertyId, userId: null,
      };
      const done = await checkOut(reservationId, { actor });
      if (!done.ok) {
        await noteEvent({
          organizationId: device.organizationId, deviceId: device.id,
          reservationId, kind: 'checkout', result: 'refused', detail: done.refusal,
        });
        refuseFacade(done.refusal, 'checkout');
      }

      await noteEvent({
        organizationId: device.organizationId, deviceId: device.id,
        reservationId, kind: 'checkout', result: 'ok', detail: phase,
      });
      if (phase === 'external') {
        // Рядок для рецепції — подія, а не лист: у фазі дзеркала фактуру
        // виставляє чужа система, і зробити це замість неї ми не можемо.
        await noteEvent({
          organizationId: device.organizationId, deviceId: device.id,
          reservationId, kind: 'invoice_elsewhere', result: 'ok',
        });
      }
      return NextResponse.json({
        ok: true,
        phase,
        balance: done.balance,
        currency: done.currency,
        // У фазі `external` номера фактури немає за побудовою — і поле
        // мовчить, а не показує порожній рядок як номер.
        invoiceExpected: phase === 'alisio',
        charged: folio.totals.charged,
      });
    });
  } catch (error) {
    return handleError('apps/kiosk checkOutStay', error, 'Не вдалося виселити');
  }
}

/** `GET /api/apps/kiosk/info` — «Info & Services»: те, що готель написав гостю. */
export async function stayInfo(request: Request): Promise<Response> {
  try {
    const device = await requireDevice(request);
    return await runWithOrganization(device.organizationId, async () => {
      const cfg = await propertyGuestConfig(device.organizationId, device.propertyId);
      return NextResponse.json({
        // Рецепція — на кожному екрані (КІ9), тому вона тут окремо, а не в
        // купі «корисного»: кнопка мусить бути там, де її шукають.
        reception: {
          phone: cfg?.emergency_phone ?? null,
          whatsapp: cfg?.whatsapp_phone ?? null,
        },
        wifi: cfg?.wifi_network ? { network: cfg.wifi_network, password: cfg.wifi_password } : null,
        parking: cfg?.parking_info ?? null,
        rules: cfg?.rules ?? null,
        usefulInfo: cfg?.useful_info ?? null,
        restaurant: cfg?.restaurant_name
          ? { name: cfg.restaurant_name, hours: cfg.restaurant_hours }
          : null,
        mapsUrl: cfg?.maps_url ?? null,
      });
    });
  } catch (error) {
    return handleError('apps/kiosk stayInfo', error, 'Не вдалося прочитати довідку');
  }
}
