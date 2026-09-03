/* eslint-disable @typescript-eslint/no-explicit-any */
import { noteStay } from '../data/stay-notes';
import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateGuestToken } from '@core/db';
import { findOrCreateGuest } from '@guests';
import { writeBookingAudit, getBookingActor } from './audit-log.handlers';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { ownedUnit } from '../data/owned.repo';
import { getSql } from '@core/db/async';
import { serverError } from '@core/http/errors';
import { percentOf } from '@core/money';

export const listReservations = withActor(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const sql = getSql();
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status') || '';
    const category = searchParams.get('category') || '';
    const search = searchParams.get('search') || '';
    const excludeChildren = searchParams.get('exclude_children') === '1';

    let query = `
      SELECT
        r.id, r.check_in, r.check_out, r.nights, r.adults, r.children,
        r.status, r.payment_status, r.source, r.total_price, r.currency, r.notes, r.internal_notes, r.created_at, r.guest_page_token,
        r.parent_id, r.commission_amount,
        r.city_tax_amount, r.city_tax_included, r.city_tax_paid,
        r.registration_status, r.hostex_channel_type, r.hostex_reservation_code, r.external_uid,
        r.is_multi_room, r.multi_room_marker,
        r.utm_source, r.utm_medium, r.utm_campaign, r.utm_term, r.utm_content,
        -- Знижка їде списком, а не тільки детальним запитом: модалка бронювання
        -- відкривається з рядка списку, і без цих двох колонок вона показувала б
        -- «0 %» на броні, де знижка є, — і перший же blur затер би її.
        r.lodging_discount_percent, r.lodging_discount_reason,
        r.breakfast_included,
        (SELECT COUNT(*) FROM reservation_sub_bookings WHERE reservation_id = r.id) as sub_booking_count,
        g.id as guest_id, g.first_name, g.last_name, g.email as guest_email, g.phone as guest_phone, g.nationality,
        u.id as unit_id, u.name as unit_name, u.code as unit_code, u.is_pool as unit_is_pool,
        c.id as category_id, c.name as category_name, c.type as category_type,
        ut.id as unit_type_id, ut.name as unit_type_name
      FROM reservations r
      JOIN guests g ON r.guest_id = g.id
      LEFT JOIN units u ON r.unit_id = u.id
      LEFT JOIN categories c ON u.category_id = c.id
      -- Тип береться від НОМЕРА, а якщо номера ще немає — від самої броні.
      --
      -- Бронь із каналу приходить із власним unit_type_id і без кімнати. Йти
      -- лише через units означало б показати рецепції «призначити номер», не
      -- сказавши ЯКОГО типу — тобто попросити зробити вибір і сховати єдине,
      -- що для нього потрібне.
      --
      -- (Без бектиків: увесь запит — шаблонний рядок JS.)
      LEFT JOIN unit_types ut ON ut.id = COALESCE(u.unit_type_id, r.unit_type_id)
      JOIN properties p ON r.property_id = p.id
      WHERE p.organization_id = ?
    `;

    const params: string[] = [actor.organizationId];

    // Hide child reservations on Bookings list page, but show them on Calendar
    if (excludeChildren) {
      query += ' AND r.parent_id IS NULL';
    }

    const excludeCancelled = searchParams.get('exclude_cancelled') === '1';
    if (excludeCancelled) {
      query += " AND r.status NOT IN ('cancelled', 'no_show')";
    } else if (status) {
      query += ' AND r.status = ?';
      params.push(status);
    }

    if (category) {
      query += ' AND c.type = ?';
      params.push(category);
    }

    if (search) {
      // Код броні на боці каналу (BDC-…) — теж ключ пошуку: гість читає
      // його з листа Booking, а не називає прізвище.
      query += ` AND (
        g.first_name LIKE ? OR g.last_name LIKE ? OR
        (g.first_name || ' ' || g.last_name) LIKE ? OR
        u.name LIKE ? OR u.code LIKE ? OR r.id LIKE ? OR r.external_uid LIKE ?
      )`;
      const like = `%${search}%`;
      params.push(like, like, like, like, like, like, like);
    }

    const paymentStatus = searchParams.get('payment_status') || '';
    if (paymentStatus) {
      query += ' AND r.payment_status = ?';
      params.push(paymentStatus);
    }

    const dateFrom = searchParams.get('date_from') || '';
    if (dateFrom) {
      query += ' AND r.check_in >= ?';
      params.push(dateFrom);
    }

    const dateTo = searchParams.get('date_to') || '';
    if (dateTo) {
      query += ' AND r.check_in <= ?';
      params.push(dateTo);
    }

    // Hide bookings already checked out before given date. Use this for
    // "current + upcoming" lists where stale departures are noise.
    const checkOutFrom = searchParams.get('check_out_from') || '';
    if (checkOutFrom) {
      query += ' AND r.check_out >= ?';
      params.push(checkOutFrom);
    }

    const sourceFilter = searchParams.get('source') || '';
    if (sourceFilter) {
      if (sourceFilter === 'widget') {
        query += " AND (r.source = 'widget' OR r.source LIKE 'widget:%')";
      } else {
        query += ' AND r.source = ?';
        params.push(sourceFilter);
      }
    }

    // Filter by specific unit (e.g. pool unit for staging strip)
    const unitIdFilter = searchParams.get('unit_id') || '';
    if (unitIdFilter) {
      query += ' AND r.unit_id = ?';
      params.push(unitIdFilter);
    }

    query += ' ORDER BY r.check_in ASC';

    const rows = await sql.rows<any>(query, params);

    return NextResponse.json(rows);
  } catch (error) {
    console.error('GET /api/bookings error:', error);
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 });
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
export const createReservation = withPermission('manage_bookings', async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const sql = getSql();
    const body = await request.json();

    const {
      firstName, lastName, email, phone,
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
      return NextResponse.json({ error: 'This unit is already booked for the selected dates' }, { status: 409 });
    }

    const org = { id: actor.organizationId };

    const dedup = await findOrCreateGuest({
      organizationId: org.id,
      firstName,
      lastName,
      email: email || null,
      phone: phone || null,
    });
    const guestId = dedup.id;

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


    await sql.run(`
      INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id, check_in, check_out, nights, adults, children, status, payment_status, source, total_price, currency, commission_amount, guest_page_token, city_tax_amount, city_tax_included, city_tax_paid, internal_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [resId, actor.organizationId, unit.property_id, unitId, guestId, checkIn, checkOut, nights || 1, adults || 1, children || 0, bookingStatus, body.paymentStatus || 'unpaid', source || 'direct', priceGiven, currency, commissionAmount, guestPageToken, finalCityTaxAmount, finalCityTaxIncluded, finalCityTaxPaid, internalNotes || null]);

    // Канали: ночі цього типу стали зайнятішими. Шлях старший за чергу й без
    // транзакції, тож одразу після запису, тим самим `sql`.
    await noteStay(sql, { property_id: unit.property_id, unit_id: unitId, check_in: checkIn, check_out: checkOut });

    // Audit log
    try {
      const actor = await getBookingActor();
      const afterRow = await sql.row<any>('SELECT * FROM reservations WHERE id = ?', [resId]);
      await writeBookingAudit(resId, 'created', `Створено: ${firstName} ${lastName} · ${source || 'direct'}`, actor, null, afterRow);
    } catch { /* non-critical */ }

    return NextResponse.json({ id: resId, guestId, guestPageToken }, { status: 201 });
  } catch (error) {
    console.error('POST /api/bookings error:', error);
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
  }
});
