/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { withActor, type Actor } from '@core/auth/session';
import { ownedReservation } from '../data/owned.repo';
import { serverError } from '@core/http/errors';
import { addReceptionRegistration, removeReceptionRegistration, setPrimaryRegistration } from '@guests';

export const listRegistrations = withActor(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }, actor: Actor) => {
  try {
    const sql = getSql();
    const { id } = await params;
    if (!await ownedReservation(actor.organizationId, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const rows = await sql.rows<any>(`
      SELECT gr.id as reg_id, gr.is_primary, gr.registered_at,
             g.id as guest_id, g.first_name, g.last_name, g.email, g.phone,
             g.document_type, g.document_number, g.date_of_birth,
             g.nationality, g.country, g.address
      FROM guest_registrations gr
      JOIN guests g ON gr.guest_id = g.id
      WHERE gr.reservation_id = ?
      ORDER BY gr.is_primary DESC, gr.created_at ASC
    `, [id]);
    return NextResponse.json(rows);
  } catch (e: any) {
    return serverError('modules/bookings/api/reservation-registrations listRegistrations', e);
  }
});

export const registerGuest = withActor(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }, actor: Actor) => {
  try {
    const sql = getSql();
    const { id } = await params;
    if (!await ownedReservation(actor.organizationId, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await request.json();

    const { firstName, lastName, dateOfBirth, documentType, documentNumber, nationality, country, address, isPrimary } = body;

    if (!firstName || !lastName || !documentNumber) {
      return NextResponse.json({ error: 'Missing required fields (name + document)' }, { status: 400 });
    }

    const org = { id: await requireOrganizationId() } as { id: string };

    let guestId: string;
    const existingGuest = await sql.row<any>('SELECT id FROM guests WHERE document_number = ? AND organization_id = ?', [documentNumber, org.id]) as { id: string } | undefined;

    if (existingGuest) {
      guestId = existingGuest.id;
      await sql.run(`
        UPDATE guests SET first_name=?, last_name=?, date_of_birth=?, document_type=?,
        document_number=?, nationality=?, country=?, address=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [firstName, lastName, dateOfBirth || null, documentType || null,
        documentNumber, nationality || null, country || null, address || null, guestId]);
    } else {
      guestId = `g_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await sql.run(`
        INSERT INTO guests (id, organization_id, first_name, last_name, date_of_birth,
        document_type, document_number, nationality, country, address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [guestId, org.id, firstName, lastName, dateOfBirth || null,
        documentType || null, documentNumber, nationality || null, country || null, address || null]);
    }

    // Обидві книги гостей одним писачем `@guests` (Д16): `guest_registrations`
    // для статусу реєстрації і `reservation_guests` для Meldeschein / книги
    // гостей — рецепція досі писала лише першу.
    const regId = await addReceptionRegistration({
      reservationId: id, guestId, isPrimary: Boolean(isPrimary),
      guest: { firstName, lastName, dateOfBirth: dateOfBirth || null, documentType: documentType || null,
        documentNumber, nationality: nationality || null, address: address || null },
    });
    if (!regId) {
      return NextResponse.json({ error: 'Guest already registered for this reservation' }, { status: 409 });
    }

    // Дочекатись: 201 без await приходив ДО запису registration_status, і
    // заселення одразу після останньої реєстрації отримувало 422.
    await updateRegistrationStatus(id);

    return NextResponse.json({ id: regId, guestId }, { status: 201 });
  } catch (e: any) {
    return serverError('modules/bookings/api/reservation-registrations registerGuest', e);
  }
});

export const removeRegistration = withActor(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }, actor: Actor) => {
  try {
    const sql = getSql();
    const { id } = await params;
    if (!await ownedReservation(actor.organizationId, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const regId = searchParams.get('reg_id');
    if (!regId) return NextResponse.json({ error: 'reg_id required' }, { status: 400 });

    // З обох книг гостей (Д16) — тим самим писачем, що й реєстрація.
    await removeReceptionRegistration({ reservationId: id, registrationId: regId });
    await updateRegistrationStatus(id);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return serverError('modules/bookings/api/reservation-registrations removeRegistration', e);
  }
});

/**
 * Хто заявник — це рішення портьє, а не порядок, у якому він взяв паспорти.
 *
 * Зірка визначає, чиє прізвище стане на Meldeschein (`meldeschein.repo`,
 * `signature.repo` — обидва беруть першого за `is_primary DESC`), тож
 * «не той заявник» — це документ для влади з чужим прізвищем.
 *
 * Чужа бронь і рядок, якого на ній немає, — однаково 404 (інваріант 5):
 * різні відповіді сказали б, які рядки існують у когось іншого.
 */
export const setPrimaryGuest = withActor(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }, actor: Actor) => {
  try {
    const { id } = await params;
    if (!await ownedReservation(actor.organizationId, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await request.json().catch(() => ({})) as { reg_id?: unknown };
    const regId = typeof body.reg_id === 'string' ? body.reg_id.trim() : '';
    if (!regId) return NextResponse.json({ error: 'reg_id required' }, { status: 400 });

    const moved = await setPrimaryRegistration({
      organizationId: actor.organizationId, reservationId: id, registrationId: regId,
    });
    if (!moved) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ id: regId, is_primary: true });
  } catch (e: any) {
    return serverError('modules/bookings/api/reservation-registrations setPrimaryGuest', e);
  }
});

async function updateRegistrationStatus(reservationId: string) {
  const sql = getSql();
  const reservation = await sql.row<any>('SELECT adults FROM reservations WHERE id = ?', [reservationId]) as { adults: number } | undefined;
  const regCount = (await sql.row<any>('SELECT COUNT(*) as cnt FROM guest_registrations WHERE reservation_id = ?', [reservationId]) as { cnt: number }).cnt;

  const needed = reservation?.adults || 1;
  const status = regCount >= needed ? 'registered' : 'not_registered';
  await sql.run('UPDATE reservations SET registration_status = ? WHERE id = ?', [status, reservationId]);
}
