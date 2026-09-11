/* eslint-disable @typescript-eslint/no-explicit-any */
import { noteStay } from '../data/stay-notes';
import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateGuestToken } from '@core/db';
import { resolveBookingGuest } from '@guests';
import { bookingPayerFields } from '@companies/kernel';
import { writeBookingAudit, getBookingActor } from './audit-log.handlers';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { ownedUnit } from '../data/owned.repo';
import { getSql } from '@core/db/async';
import { serverError, handleError } from '@core/http/errors';
import { percentOf } from '@core/money';
import { requestPropertyScope } from '@core/auth/property-scope';
import { listReservationRows } from '../data/lists.repo';
import { insertingStay, UnitOverlap } from './overlap';

/**
 * Одна відмова на одну причину.
 *
 * Її кажуть ДВА місця: перевірка перед записом (у 99 % випадків) і обмеження
 * бази (в останньому відсотку, коли двоє писали одночасно). Гість не має
 * бачити двох різних текстів на одне й те саме, тож текст один — константою, а
 * не двома літералами, які розійдуться при першій же правці (INC-045).
 */
const ALREADY_BOOKED = 'This unit is already booked for the selected dates';

export const listReservations = withActor(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    // Область обʼєкта ТИПОМ (INC-029). Тут уже був `?property_id=`, і він
    // працював, але: (1) статично не читався — фрагмент, приклеєний за межами
    // літерала, гейт бачить як «не доведено»; (2) не памʼятав вибір оператора
    // з куки, тож перехід між екранами губив обʼєкт; (3) чужий id мовчки давав
    // порожньо замість 404. Двері одні на всі читання.
    //
    // Сам запит — `data/lists.repo.ts`: із маршруту його не засвідчити, бо
    // `withActor` кличе `cookies()`, а поза запитом Next це виняток.
    const scope = await requestPropertyScope(request, actor.organizationId);
    const { searchParams } = new URL(request.url);
    return NextResponse.json(await listReservationRows(actor.organizationId, scope, searchParams));
  } catch (error) {
    // Названа відмова їде своїм статусом (інваріант 6, Ц43). Тут це не
    // дрібниця: чужий `property_id` кидає `PropertyNotFound` — 404, — і
    // глухий 500 перетворював «не той будинок» на «сервер зламався».
    return handleError('modules/bookings/api/reservations listReservations', error);
  }
});

// Creating a booking is a write, so it wants the permission, not just a
// session. housekeeper and maintenance carry only `nav:dashboard`, yet through
// this route they could create, reprice and delete any booking — the interface
// hid the screen and the API did not.
//
// Reading (listReservations, getReservation) deliberately stays on withActor:
// the accountant role has no manage_bookings and does need to see bookings
// behind the finance screens. Narrowing that is a product decision, not a
// mechanical one.
/**
 * Розгорнутий обробник — щоб сцена могла викликати його з готовою особою
 * (той самий розподіл, що в `@invoicing`). Це не зручність: `INSERT` тут —
 * РЯДОК, і `tsc` не бачить у ньому ні неіснуючої колонки, ні розʼїханого
 * числа знаків питання — тобто 500 на КОЖНІЙ броні при зеленій збірці.
 * Загорнутий `createReservation` нижче — те, що виставлене маршрутом.
 */
export async function createReservationHandler(request: NextRequest, _ctx: unknown, actor: Actor) {
  try {
    const sql = getSql();
    const body = await request.json();

    const {
      firstName, lastName, email, phone,
      // Гість, якого рецепція ОБРАЛА зі списку. Порожньо — як було, вгадування.
      guestId,
      // Фірма-платник, названа відразу. Порожньо — платить гість, як і досі.
      companyId,
      unitId, checkIn, checkOut, nights,
      adults, children, status, source, totalPrice,
      commissionAmount: commissionOverride,
      cityTaxAmount, cityTaxIncluded, cityTaxPaid,
      internalNotes,
    } = body;

    if (!firstName || !lastName || !unitId || !checkIn || !checkOut) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // The price is named, or there is no booking. `totalPrice || 0` accepted a
    // body without one and wrote a confirmed reservation worth nothing — the
    // booking form asks the quote first and refuses to submit without an
    // answer, but the form was the only thing standing there, so any other
    // caller booked for free. A zero the operator typed on purpose (staff stay,
    // owner's room) still passes: what is refused is silence.
    // AGENTS.md §3 invariant 17 — a price nobody named does not exist.
    const priceGiven = Number(totalPrice);
    if (totalPrice === undefined || totalPrice === null || totalPrice === ''
      || !Number.isFinite(priceGiven) || priceGiven < 0) {
      return NextResponse.json(
        { error: 'Вартість бронювання обовʼязкова: порахуйте її або введіть вручну' },
        { status: 400 });
    }

    // Wrong tenant's unit looks exactly like a missing one.
    const unit = await ownedUnit(actor.organizationId, unitId);
    if (!unit) {
      return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
    }

    const overlap = await sql.row<any>(`
      SELECT 1 FROM reservations
      WHERE unit_id = ? AND status NOT IN ('cancelled', 'no_show')
        AND check_in < ? AND check_out > ?
      LIMIT 1
    `, [unitId, checkOut, checkIn]);
    if (overlap) {
      return NextResponse.json({ error: ALREADY_BOOKED }, { status: 409 });
    }

    const org = { id: actor.organizationId };

    // Названий гість береться як названий; не названий — вгадується, як було.
    // Різниця не косметична: остання ланка дедупу — збіг за САМИМ ІМЕНЕМ, тож
    // двоє однофамільців без пошти й телефону для нього одна людина. Поки
    // вибору не було, це просто траплялось; із вибором мовчазна підміна
    // означала б «показали одного, записали іншого» (`booking-guest.repo`).
    const dedup = await resolveBookingGuest({
      organizationId: org.id,
      guestId: guestId || null,
      firstName,
      lastName,
      email: email || null,
      phone: phone || null,
    });
    const resolvedGuestId = dedup.id;

    // Платник-юрособа тепер називається ВІДРАЗУ, а не наступним кліком із
    // картки. Ті самі двері, що й у PATCH — інакше два писачі тих самих семи
    // колонок розійшлися б мовчки, а помітили б це на фактурі.
    const payer = await bookingPayerFields(actor.organizationId, companyId);
    if (!payer.ok) {
      return payer.reason === 'archived'
        ? NextResponse.json({ error: 'company_archived' }, { status: 409 })
        : NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const p = payer.fields;

    const resId = `r_${Date.now()}`;
    let commissionAmount = 0;
    if (commissionOverride !== undefined && commissionOverride !== null) {
      commissionAmount = Number(commissionOverride);
    } else if (source) {
      // Орендар названий у запиті. `booking_sources` тримається за обʼєкт, а
      // не за організацію, і `WHERE code = ?` без цього приєднання брав ПЕРШИЙ
      // рядок із таким кодом у всій базі: комісія готелю A рахувалась за
      // ставкою готелю B. На Postgres це прикриває RLS, на SQLite — ніщо, і
      // саме тому фільтр мусить бути в SQL, а не покладатись на політику.
      const bsRow = await sql.row<any>(
        `SELECT bs.commission_percent FROM booking_sources bs
           JOIN properties p ON p.id = bs.property_id
          WHERE bs.code = ? AND p.organization_id = ?`,
        [source, org.id]) as { commission_percent: number } | undefined;
      if (bsRow && bsRow.commission_percent > 0) {
        // Комісія — гроші: 15 % від 119 € це 17,85 €, а не 18 €. Саме це
        // число потім звіряють із випискою каналу.
        //
        // `priceGiven`, а не `totalPrice`: ціна вже перевірена вище й
        // приведена до числа, і саме вона лягає в рядок броні.
        commissionAmount = percentOf(priceGiven, bsRow.commission_percent);
      }
    }

    const finalCityTaxAmount = cityTaxAmount !== undefined ? Number(cityTaxAmount) : 0;
    const finalCityTaxIncluded = cityTaxIncluded ? 1 : 0;
    const finalCityTaxPaid = cityTaxPaid || 'pending';

    const bookingStatus = status || 'confirmed';
    const guestPageToken = (bookingStatus === 'confirmed' || bookingStatus === 'checked_in') ? generateGuestToken() : null;

    // Валюта — організації, не колонковий DEFAULT: дефолт у схемі — це валюта
    // першого клієнта, і німецька бронь із ним показувала «255 CZK».
    //
    // Тут стояло `|| 'EUR'`. Другий літерал замість першого — це та сама
    // помилка: організація, якої запит не побачив (порожній контекст орендаря
    // на Postgres читається як «рядка немає», а не як виняток), тихо
    // отримувала євро. Порожньо — відмовляємось, як `folio.resolveCurrency()`:
    // вгадана валюта їде далі в бронь, на гостьову сторінку і у фактуру, і
    // помилки в ній ніхто не помітить, поки гість не заплатить не ту суму.
    const orgRow = await sql.row<any>(
      'SELECT default_currency FROM organizations WHERE id = ?', [actor.organizationId]) as { default_currency?: string } | undefined;
    const currency = orgRow?.default_currency ? String(orgRow.default_currency) : '';
    if (!currency) {
      return serverError('modules/bookings/api/reservations createReservation',
        new Error(`No currency for organization ${actor.organizationId}: set organizations.default_currency`));
    }


    // Двері INC-045. Перевірка вище лишається — вона дає людський текст майже
    // завжди; ці двері тримають те, що між нею і цим рядком стоять `await`-и
    // (дедуплікація гостя, комісія, валюта). У це вікно проходили ОБИДВІ броні.
    try {
      await insertingStay(() => sql.run(`
        INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id, check_in, check_out, nights, adults, children, status, payment_status, source, total_price, currency, commission_amount, guest_page_token, city_tax_amount, city_tax_included, city_tax_paid, internal_notes, company_id, invoice_company_name, invoice_company_ico, invoice_company_dic, invoice_company_address, invoice_company_city, invoice_company_country, invoice_company_email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [resId, actor.organizationId, unit.property_id, unitId, resolvedGuestId, checkIn, checkOut, nights || 1, adults || 1, children || 0, bookingStatus, body.paymentStatus || 'unpaid', source || 'direct', priceGiven, currency, commissionAmount, guestPageToken, finalCityTaxAmount, finalCityTaxIncluded, finalCityTaxPaid, internalNotes || null, p.company_id, p.invoice_company_name, p.invoice_company_ico, p.invoice_company_dic, p.invoice_company_address, p.invoice_company_city, p.invoice_company_country, p.invoice_company_email]),
      { unitId, checkIn, checkOut, reservationId: resId });
    } catch (e) {
      if (e instanceof UnitOverlap) {
        return NextResponse.json({ error: ALREADY_BOOKED }, { status: 409 });
      }
      throw e;
    }

    // Канали: ночі цього типу стали зайнятішими. Шлях старший за чергу й без
    // транзакції, тож одразу після запису, тим самим `sql`.
    await noteStay(sql, { property_id: unit.property_id, unit_id: unitId, check_in: checkIn, check_out: checkOut });

    // Audit log
    try {
      const actor = await getBookingActor();
      const afterRow = await sql.row<any>('SELECT * FROM reservations WHERE id = ?', [resId]);
      await writeBookingAudit(resId, 'created', `Створено: ${firstName} ${lastName} · ${source || 'direct'}`, actor, null, afterRow);
    } catch { /* non-critical */ }

    return NextResponse.json({ id: resId, guestId: resolvedGuestId, guestPageToken }, { status: 201 });
  } catch (error) {
    // `handleError`, не голий 500: відмови, названі на місці кидання
    // (`resolveBookingGuest` — чужий гість, злитий рядок), мусять дійти до
    // портьє СВОЇМ текстом і своїм статусом. Доти цей `catch` згортав їх у
    // «Failed to create booking», і екран показував поломку там, де було
    // правило — рівно те, від чого інваріант 6. Решта й далі йде в лог і
    // повертає 500 загальним реченням.
    return handleError('POST /api/bookings', error, 'Failed to create booking');
  }
}

export const createReservation = withPermission('manage_bookings', createReservationHandler);
