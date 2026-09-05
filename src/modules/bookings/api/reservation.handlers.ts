/* eslint-disable @typescript-eslint/no-explicit-any */
import { noteStay, movesStay, staysOfParent } from '../data/stay-notes';
import { writeReservationChange } from '../data/reservation-write.repo';
import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateGuestToken } from '@core/db';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { ownedReservation, ownedUnit } from '../data/owned.repo';
import { generateInvoiceForReservation } from '@invoicing';
import { cookies } from 'next/headers';
import { getSessionUser } from '@core/auth';
import { writeBookingAudit, getBookingActor, buildBookingLabel } from './audit-log.handlers';
import { getSql } from '@core/db/async';
import { serverError } from '@core/http/errors';
import { decideCheckout } from '../data/checkout.repo';
import type { CheckoutDecision } from '../domain/checkout-balance';
import { companyPayer } from '@companies/kernel';

export const getReservation = withActor(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }, actor: Actor) => {
  try {
    const sql = getSql();
    const { id } = await params;
    if (!await ownedReservation(actor.organizationId, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const row = await sql.row<any>(`
      SELECT
        r.*, r.guest_page_token, g.first_name, g.last_name, g.email as guest_email, g.phone as guest_phone, g.country as guest_country,
        u.name as unit_name, u.code as unit_code,
        c.name as category_name, c.type as category_type,
        ut.name as unit_type_name,
        p.name as property_name
      FROM reservations r
      JOIN guests g ON r.guest_id = g.id
      JOIN properties p ON r.property_id = p.id
      LEFT JOIN units u ON r.unit_id = u.id
      LEFT JOIN categories c ON u.category_id = c.id
      LEFT JOIN unit_types ut ON u.unit_type_id = ut.id
      WHERE r.id = ?
    `, [id]);

    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Attach sub-bookings + line items
    const subBookings = await sql.rows<any>(`
      SELECT sb.*,
        cr.unit_id as child_unit_id,
        cr.payment_status as child_payment_status,
        cr.guest_page_token as child_guest_page_token,
        u2.name as child_unit_name, u2.code as child_unit_code
      FROM reservation_sub_bookings sb
      LEFT JOIN reservations cr ON sb.child_reservation_id = cr.id
      LEFT JOIN units u2 ON cr.unit_id = u2.id
      WHERE sb.reservation_id = ?
      ORDER BY sb.sort_order, sb.created_at
    `, [id]) as any[];

    const subBookingsWithItems = await Promise.all(subBookings.map(async (sb: any) => ({
      ...sb,
      lineItems: await sql.rows<any>(
        'SELECT * FROM reservation_line_items WHERE sub_booking_id = ? ORDER BY sort_order',
        [sb.id],
      ),
    })));

    // Count children
    const childCount = (await sql.row<any>('SELECT COUNT(*) as n FROM reservations WHERE parent_id = ?', [id]) as any).n;

    return NextResponse.json({
      ...row as any,
      subBookings: subBookingsWithItems,
      childReservationCount: childCount,
    });
  } catch (error: any) {
    console.error('GET /api/bookings/[id] error:', error?.message || error);
    return serverError('modules/bookings/api/reservation getReservation', error, 'Failed to fetch booking');
  }
});

export const updateReservation = withPermission('manage_bookings', async (request: NextRequest, { params }: { params: Promise<{ id: string }> }, actor: Actor) => {
  try {
    const sql = getSql();
    const { id } = await params;
    const owned = await ownedReservation(actor.organizationId, id);
    if (!owned) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await request.json();

    // Owning the booking is not owning the room it is being moved into.
    //
    // `ownedReservation` above proved the caller may edit THIS booking. The new
    // unit_id arrives in the body and was written straight through: a
    // receptionist — or anything posting to this endpoint — could move a
    // booking onto another hotel's room. The booking then occupies a unit its
    // own organization cannot see, the neighbour's calendar shows a stay
    // nobody there made, and the overlap check below runs against the wrong
    // hotel's inventory.
    if (body.unit_id !== undefined && body.unit_id !== null) {
      if (!await ownedUnit(actor.organizationId, String(body.unit_id))) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
    }

    console.log('[PATCH] booking id:', id, 'body:', JSON.stringify(body));

    // Платник-юрособа (0093, Блок 4 §2.3). Компанія з довідника СВОЄЇ
    // організації — інакше 404 (інваріант 5): бронь готелю А не виставляється
    // на фірму готелю Б. Вибір переписує знімок `invoice_company_*` з
    // довідника — документ читає знімок, а не живий рядок; NULL повертає
    // платника-фізособу і чистить знімок.
    if (body.company_id !== undefined) {
      if (body.company_id === null || body.company_id === '') {
        body.company_id = null;
        Object.assign(body, {
          invoice_company_name: null, invoice_company_ico: null, invoice_company_dic: null,
          invoice_company_address: null, invoice_company_city: null, invoice_company_country: null,
          invoice_company_email: null,
        });
      } else {
        const payer = await companyPayer(actor.organizationId, String(body.company_id));
        if (!payer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        if (payer.archived) return NextResponse.json({ error: 'company_archived' }, { status: 409 });
        body.company_id = payer.id;
        Object.assign(body, {
          invoice_company_name: payer.invoice_company_name, invoice_company_ico: payer.invoice_company_ico,
          invoice_company_dic: payer.invoice_company_dic, invoice_company_address: payer.invoice_company_address,
          invoice_company_city: payer.invoice_company_city, invoice_company_country: payer.invoice_company_country,
          invoice_company_email: payer.invoice_company_email,
        });
      }
    }

    const allowed = [
      'company_id',
      'unit_id', 'check_in', 'check_out', 'nights', 'adults', 'children', 'infants',
      'status', 'payment_status', 'source', 'total_price', 'commission_amount',
      'notes', 'internal_notes',
      'city_tax_amount', 'city_tax_included', 'city_tax_paid', 'registration_status',
      // Invoice-to-company override fields (PATCH from BookingViewModal)
      'invoice_company_name', 'invoice_company_ico', 'invoice_company_dic',
      'invoice_company_address', 'invoice_company_city', 'invoice_company_country',
      'invoice_company_email',
      // A reduction granted by hand on the accommodation. The percent is
      // clamped below rather than trusted from the body: this list only says
      // which columns may be written, not what may be written into them.
      'lodging_discount_percent', 'lodging_discount_reason',
      // What was sold: NULL follows the channel rule, TRUE/FALSE overrides it
      // for this booking. Normalized below — the column is a three-state flag,
      // not a place for whatever the body carried.
      'breakfast_included',
    ];
    // 0…100, decided here and not left to the database.
    //
    // The CHECK in the schema refuses anything else, but a refusal arrives as
    // a 500 and a stack trace. A percent typed with a stray minus is an
    // ordinary slip at a reception desk, and the answer to it is the number
    // the hotel meant, not an error page. Above 100 would make the hotel owe
    // money for the stay; below zero would raise the guest's bill from a box
    // labelled "discount".
    if (body.lodging_discount_percent !== undefined) {
      const p = Number(body.lodging_discount_percent);
      body.lodging_discount_percent = Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0;
    }
    // Three states and nothing else: null (follow the rule), 1, 0. Written as
    // integers because the SQLite column is INTEGER and Postgres casts a bound
    // 1/0 into BOOLEAN; a bare string like "yes" must not survive to either.
    if (body.breakfast_included !== undefined && body.breakfast_included !== null) {
      body.breakfast_included = (body.breakfast_included === true
        || body.breakfast_included === 1 || body.breakfast_included === '1') ? 1 : 0;
    }

    const sets: string[] = [];
    const values: (string | number)[] = [];

    // Capture full row snapshot BEFORE the update for audit trail
    const beforeSnapshot = await sql.row<any>('SELECT * FROM reservations WHERE id = ?', [id]);

    if (body.status === 'checked_in') {
      const current = await sql.row<any>('SELECT payment_status, registration_status FROM reservations WHERE id = ?', [id]) as any;
      const payStatus = body.payment_status || current?.payment_status;
      const regStatus = current?.registration_status;

      if (!['paid', 'prepaid'].includes(payStatus)) {
        return NextResponse.json({ error: 'Неможливо заселити без повної оплати. Спочатку завершіть оплату.' }, { status: 422 });
      }
      if (regStatus !== 'registered') {
        return NextResponse.json({ error: 'Неможливо заселити без реєстрації гостей. Заповніть документи всіх гостей.' }, { status: 422 });
      }
    }

    // Виселення з боргом — за політикою ОБʼЄКТА (0091, Блок 4): `none` не
    // дивиться, `warning` виселяє з прапорцем у відповіді, `blocking` — 422 з
    // назвою причини. Борг — з фоліо броні; без фоліо — зі статусу оплати,
    // того самого слова, за яким варта заселення пускає гостя в номер.
    // Домен — `checkout-balance.ts`, обидві осі тримає його перевірка.
    // Заселення в неприбраний номер — попередження, не заборона (Блок 4 §2.2):
    // рецепція бачить, що номер брудний, і вирішує сама.
    let checkinWarning: 'unit_dirty' | null = null;
    if (body.status === 'checked_in') {
      const targetUnit = body.unit_id ?? beforeSnapshot?.unit_id;
      if (targetUnit) {
        const u = await sql.row<any>('SELECT cleaning_status FROM units WHERE id = ?', [targetUnit]);
        if (u && u.cleaning_status !== 'clean') checkinWarning = 'unit_dirty';
      }
    }

    let checkout: CheckoutDecision | null = null;
    if (body.status === 'checked_out' && beforeSnapshot?.status !== 'checked_out') {
      const decision = await decideCheckout(sql, {
        organizationId: actor.organizationId, propertyId: owned.property_id, reservationId: id,
        paymentStatus: body.payment_status ?? beforeSnapshot?.payment_status,
        totalPrice: Number(beforeSnapshot?.total_price) || 0,
      });
      // Обʼєкта немає — політики немає — виселення не дозволяється (інваріант 13).
      if (decision === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
      checkout = decision;
      if (!checkout.allowed) {
        return NextResponse.json(
          { error: 'checkout_balance_blocking', balance: checkout.balance, currency: beforeSnapshot?.currency ?? null },
          { status: 422 });
      }
    }

    // Snapshot BEFORE the UPDATE so the activity log can record the
    // previous unit. Reading after the UPDATE would just echo the new
    // value back at us.
    let prevUnitLabel: string | null = null;
    if (body.unit_id !== undefined) {
      const prevRow = await sql.row<any>('SELECT u.name AS unit_name, r.unit_id FROM reservations r LEFT JOIN units u ON u.id = r.unit_id WHERE r.id = ?', [id]) as { unit_name?: string; unit_id?: string } | undefined;
      prevUnitLabel = prevRow?.unit_name || prevRow?.unit_id || null;
    }

    // Overlap guard: if unit_id and/or date range is changing, make sure
    // the target unit is free across the (possibly new) dates. POST has
    // this check; PATCH historically did not, so unit reassignment via
    // edit forms or the room-allocation modal could silently double-book.
    // Staging pool units intentionally hold many bookings at once — skip
    // the check when the target unit is a pool.
    if (body.unit_id !== undefined || body.check_in !== undefined || body.check_out !== undefined) {
      const current = await sql.row<any>('SELECT unit_id, check_in, check_out FROM reservations WHERE id = ?', [id]) as { unit_id: string; check_in: string; check_out: string } | undefined;
      if (current) {
        const targetUnit = body.unit_id !== undefined ? body.unit_id : current.unit_id;
        const targetIn  = body.check_in   !== undefined ? body.check_in  : current.check_in;
        const targetOut = body.check_out  !== undefined ? body.check_out : current.check_out;
        const targetUnitRow = await sql.row<any>('SELECT is_pool FROM units WHERE id = ?', [targetUnit]) as { is_pool?: number } | undefined;
        if (!targetUnitRow?.is_pool) {
          const overlap = await sql.row<any>(`
            SELECT id FROM reservations
            WHERE unit_id = ? AND id <> ? AND status NOT IN ('cancelled', 'no_show')
              AND check_in < ? AND check_out > ?
            LIMIT 1
          `, [targetUnit, id, targetOut, targetIn]) as { id: string } | undefined;
          if (overlap) {
            return NextResponse.json(
              { error: 'Кімната зайнята на ці дати іншим бронюванням', conflictBookingId: overlap.id },
              { status: 409 },
            );
          }
        }
      }
    }

    for (const key of allowed) {
      if (body[key] !== undefined) {
        sets.push(`${key} = ?`);
        values.push(body[key]);
      }
    }

    if (body.status && (body.status === 'confirmed' || body.status === 'checked_in')) {
      const existing = await sql.row<any>('SELECT guest_page_token FROM reservations WHERE id = ?', [id]) as any;
      if (!existing?.guest_page_token) {
        sets.push('guest_page_token = ?');
        values.push(generateGuestToken());
      }
    }

    // Generate guest token on demand (from mobile footer buttons)
    if (body.generate_guest_token) {
      const existing = await sql.row<any>('SELECT guest_page_token FROM reservations WHERE id = ?', [id]) as any;
      if (!existing?.guest_page_token) {
        sets.push('guest_page_token = ?');
        values.push(generateGuestToken());
      }
    }

    // Track old payment_status for TG notification editing
    let oldPaymentStatus: string | null = null;
    if (body.payment_status) {
      const oldRes = await sql.row<any>('SELECT payment_status FROM reservations WHERE id = ?', [id]) as any;
      oldPaymentStatus = oldRes?.payment_status || null;
    }

    // Одна транзакція на бронь, її ночі в каналі, дочірні броні і — при
    // виселенні — стан прибирання номера (Блок 4, 0092). Тіло транзакції —
    // `reservation-write.repo.ts`, сцена поруч.
    if (sets.length > 0) {
      sets.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      await writeReservationChange(sql, {
        organizationId: actor.organizationId, reservationId: id,
        statement: `UPDATE reservations SET ${sets.join(', ')} WHERE id = ?`, values,
        movesStay: movesStay(body),
        cascade: {
          status: body.status, payment_status: body.payment_status, check_in: body.check_in,
          check_out: body.check_out, nights: body.nights, source: body.source,
        },
        checkout: checkout ? { changedBy: actor.user.id } : null,
      });
    }

    // Emit payment status change event for TG notification editing
    if (body.payment_status && oldPaymentStatus !== body.payment_status) {
      import('@core/event-bus').then(({ eventBus }) => {
        eventBus.emit('booking.payment_status_changed', {
          bookingId: id,
          oldStatus: oldPaymentStatus || 'unpaid',
          newStatus: body.payment_status,
        });
      }).catch(() => {});
    }

    if (body.firstName || body.lastName || body.email || body.phone) {
      const res = await sql.row<any>('SELECT guest_id FROM reservations WHERE id = ?', [id]) as any;
      if (res) {
        const guestSets: string[] = [];
        const guestVals: string[] = [];

        if (body.firstName) { guestSets.push('first_name = ?'); guestVals.push(body.firstName); }
        if (body.lastName) { guestSets.push('last_name = ?'); guestVals.push(body.lastName); }
        if (body.email) { guestSets.push('email = ?'); guestVals.push(body.email); }
        if (body.phone) { guestSets.push('phone = ?'); guestVals.push(body.phone); }

        if (guestSets.length > 0) {
          guestVals.push(res.guest_id);
          await sql.run(`UPDATE guests SET ${guestSets.join(', ')} WHERE id = ?`, [...guestVals]);
        }
      }
    }

    // --- Audit logging with user + before/after ---
    try {
      const actor = await getBookingActor();
      const afterRow = await sql.row<any>('SELECT * FROM reservations WHERE id = ?', [id]);
      const logActions: { action: string; details: string }[] = [];
      if (body.status) logActions.push({ action: 'status_change', details: `Статус → ${body.status}` });
      if (body.payment_status) logActions.push({ action: 'payment_status_change', details: `Оплата → ${body.payment_status}` });
      // Валюта — броні, не одного клієнта: «CZK» тут стояло літералом.
      if (body.total_price !== undefined) logActions.push({ action: 'price_change', details: `Ціна → ${body.total_price} ${beforeSnapshot?.currency || ''}`.trim() });
      if (body.adults !== undefined || body.children !== undefined) {
        const was = `${beforeSnapshot?.adults ?? '—'}+${beforeSnapshot?.children ?? 0}`;
        const now = `${body.adults ?? beforeSnapshot?.adults ?? '—'}+${body.children ?? beforeSnapshot?.children ?? 0}`;
        logActions.push({ action: 'guests_change', details: `Гості: ${was} → ${now}` });
      }
      if (body.unit_id !== undefined) {
        const nextRow = await sql.row<any>('SELECT name FROM units WHERE id = ?', [body.unit_id]) as { name?: string } | undefined;
        const before = prevUnitLabel || '—';
        const after  = nextRow?.name || body.unit_id;
        logActions.push({ action: 'unit_change', details: `Юніт: ${before} → ${after}` });
      }
      if (body.check_in || body.check_out) logActions.push({ action: 'dates_change', details: `Дати: ${body.check_in || '—'} — ${body.check_out || '—'}` });
      if (body.notes !== undefined) logActions.push({ action: 'notes_change', details: 'Нотатки змінено' });
      if (body.internal_notes !== undefined) logActions.push({ action: 'internal_notes_change', details: 'Внутрішні нотатки змінено' });
      if (body.registration_status) logActions.push({ action: 'registration_change', details: `Реєстрація → ${body.registration_status}` });
      for (const log of logActions) {
        await writeBookingAudit(id, log.action, log.details, actor, beforeSnapshot, afterRow);
      }
    } catch { /* non-critical */ }

    // Auto-generate invoice when payment_status is manually set to 'paid'.
    // Cash marked by the operator counts as confirmed; any other manual "paid"
    // (card/online without a Teya confirmation) stays unconfirmed and is excluded
    // from the monthly ISDOC export until reconciled.
    if (body.payment_status === 'paid') {
      const isCash = body.payment_method === 'cash';
      generateInvoiceForReservation(id, isCash ? { confirmed: true, source: 'cash' } : { confirmed: false, source: 'manual' });
    }

    // Return updated booking with guest_page_token — і прапорець виселення з
    // боргом під `warning`, щоб рецепція побачила суму, а не лише «готово».
    const updated = await sql.row<any>('SELECT guest_page_token FROM reservations WHERE id = ?', [id]) as any;
    return NextResponse.json({
      success: true,
      guest_page_token: updated?.guest_page_token || null,
      ...(checkout?.warning
        ? { warning: checkout.warning, balance: checkout.balance, currency: beforeSnapshot?.currency ?? null }
        : checkinWarning ? { warning: checkinWarning } : {}),
    });
  } catch (error: any) {
    console.error('PATCH /api/bookings/[id] error:', error?.message || error);
    return serverError('modules/bookings/api/reservation updateReservation', error, 'Failed to update booking');
  }
});

export const deleteReservation = withPermission('manage_bookings', async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }, sessionActor: Actor) => {
  try {
    const sql = getSql();
    const { id } = await params;
    if (!await ownedReservation(sessionActor.organizationId, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Capture snapshot + actor BEFORE deletion for audit
    const beforeSnapshot = await sql.row<any>('SELECT * FROM reservations WHERE id = ?', [id]) as any;
    const label = await buildBookingLabel(id);
    const actor = await getBookingActor();

    await sql.tx(async (t) => {
      // 1. Канали — у ТІЙ САМІЙ транзакції, до того як рядки зникнуть: ночі
      //    головної й дочірніх броней звільняються.
      await noteStay(t, beforeSnapshot);
      for (const child of await staysOfParent(t, id)) await noteStay(t, child);

      // 2. Delete related cart events (keep activity logs — no cascade)
      await t.run('DELETE FROM cart_events WHERE reservation_id = ?', [id]);

      // 3. Delete service orders
      await t.run('DELETE FROM service_orders WHERE reservation_id = ?', [id]);
      await t.run('DELETE FROM booking_service_orders WHERE reservation_id = ?', [id]);

      // 4. Delete sub-booking structures (bundles)
      await t.run(`
        DELETE FROM reservation_line_items 
        WHERE sub_booking_id IN (SELECT id FROM reservation_sub_bookings WHERE reservation_id = ?)
      `, [id]);
      await t.run('DELETE FROM reservation_sub_bookings WHERE reservation_id = ? OR child_reservation_id = ?', [id, id]);

      // 5. Delete child reservations
      await t.run('DELETE FROM reservations WHERE parent_id = ?', [id]);

      // 6. Finally delete the main reservation
      await t.run('DELETE FROM reservations WHERE id = ?', [id]);
    });

    // Write audit AFTER deletion (FK removed in migration, so this works)
    await writeBookingAudit(id, 'deleted', `Видалено: ${label}`, actor, beforeSnapshot, null, label);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/bookings/[id] error:', error?.message || error);
    return serverError('modules/bookings/api/reservation deleteReservation', error, 'Failed to delete booking');
  }
});
