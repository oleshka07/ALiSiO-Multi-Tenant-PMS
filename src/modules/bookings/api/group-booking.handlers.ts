/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { serverError } from '@core/http/errors';

/**
 * One group booking, by id — read, changed and deleted with no tenant named.
 *
 * `reservation_groups` reaches its organization through `property_id`.
 * `ownedGroup` is that join, asked once at the top of each handler; DELETE
 * needed it most, because it took every reservation in the group with it and
 * asked nothing at all first.
 */
async function ownedGroup(organizationId: string, id: string): Promise<{ id: string } | undefined> {
  const sql = getSql();
  return await sql.row<{ id: string }>(`
    SELECT rg.id FROM reservation_groups rg
    JOIN properties p ON rg.property_id = p.id
    WHERE rg.id = ? AND p.organization_id = ?
  `, [id, organizationId]);
}

export const getGroupBooking = withActor(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }, actor: Actor) => {
  try {
    const { id } = await params;
    const sql = getSql();

    if (!await ownedGroup(actor.organizationId, id)) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const group = await sql.row<any>(`
      SELECT rg.*,
        g.first_name, g.last_name, g.email as guest_email, g.phone as guest_phone,
        b.name as building_name, b.code as building_code
      FROM reservation_groups rg
      JOIN guests g ON rg.guest_id = g.id
      LEFT JOIN buildings b ON rg.building_id = b.id
      WHERE rg.id = ?
    `, [id]);

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const rooms = await sql.rows<any>(`
      SELECT r.id, r.unit_id, r.adults, r.children, r.status, r.total_price,
        u.name as unit_name, u.code as unit_code,
        g.first_name, g.last_name, g.email as guest_email, g.phone as guest_phone,
        g.id as guest_id
      FROM reservations r
      JOIN units u ON r.unit_id = u.id
      JOIN guests g ON r.guest_id = g.id
      WHERE r.group_id = ?
      ORDER BY u.sort_order, u.code
    `, [id]);

    return NextResponse.json({ ...group as any, rooms });
  } catch (e: any) {
    return serverError('modules/bookings/api/group-booking getGroupBooking', e);
  }
});

export const updateGroupBooking = withPermission('manage_bookings', async (request: NextRequest, { params }: { params: Promise<{ id: string }> }, actor: Actor) => {
  try {
    const { id } = await params;
    const sql = getSql();
    const body = await request.json();

    if (!await ownedGroup(actor.organizationId, id)) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const existing = await sql.row<any>('SELECT * FROM reservation_groups WHERE id = ?', [id]) as any;
    if (!existing) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    // Виїзд мусить бути після заїзду — і це перевіряється ТУТ, а не лише у
    // формі. Помилка, яка тут була: `GroupViewModal` рахував ночі як
    // `Math.max(1, ceil(diff))`, тож перевернутий діапазон давав від'ємну
    // різницю, яка перетворювалась на 1. Група зі 2026-08-20 по 2026-08-15
    // зберігалась і скрізь показувалась як «1 ніч»; ті самі дати каскадом
    // лягали на кожну броню групи нижче, і календар малював стіни, яких
    // немає. Клієнт міг і не питати — перевірку тримає сервер.
    //
    // Порівнюємо ефективні значення: PATCH частковий, тож зсув однієї дати
    // повинен звірятися з тією, що вже лежить у базі.
    const nextCheckIn = body.check_in !== undefined ? body.check_in : existing.check_in;
    const nextCheckOut = body.check_out !== undefined ? body.check_out : existing.check_out;
    if ((body.check_in !== undefined || body.check_out !== undefined) && nextCheckIn && nextCheckOut) {
      const start = new Date(nextCheckIn);
      const end = new Date(nextCheckOut);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return NextResponse.json({ error: 'Дати мають бути у форматі YYYY-MM-DD' }, { status: 400 });
      }
      if (end <= start) {
        return NextResponse.json({ error: 'Дата виїзду має бути пізніше за дату заїзду' }, { status: 400 });
      }
      // Ночі рахує сервер із власних дат, а не тіло запиту: інакше можна
      // зберегти коректний діапазон і брехливу кількість ночей поруч.
      body.nights = Math.round((end.getTime() - start.getTime()) / 86400000);
    }

    const allowed = ['total_price', 'status', 'payment_status', 'source', 'notes', 'check_in', 'check_out', 'nights'];
    const sets: string[] = [];
    const values: any[] = [];

    for (const key of allowed) {
      if (body[key] !== undefined) {
        sets.push(`${key} = ?`);
        values.push(body[key]);
      }
    }

    if (sets.length > 0) {
      sets.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      await sql.run(`UPDATE reservation_groups SET ${sets.join(', ')} WHERE id = ?`, [...values]);
    }

    if (body.first_name || body.last_name || body.guest_phone) {
      const guestUpdate: string[] = [];
      const guestValues: any[] = [];
      if (body.first_name !== undefined) { guestUpdate.push('first_name = ?'); guestValues.push(body.first_name); }
      if (body.last_name !== undefined) { guestUpdate.push('last_name = ?'); guestValues.push(body.last_name); }
      if (body.guest_phone !== undefined) { guestUpdate.push('phone = ?'); guestValues.push(body.guest_phone); }
      if (guestUpdate.length > 0) {
        guestValues.push(existing.guest_id);
        await sql.run(`UPDATE guests SET ${guestUpdate.join(', ')} WHERE id = ?`, [...guestValues]);
      }
    }

    if (body.status) {
      await sql.run('UPDATE reservations SET status = ? WHERE group_id = ?', [body.status, id]);
    }
    if (body.payment_status) {
      await sql.run('UPDATE reservations SET payment_status = ? WHERE group_id = ?', [body.payment_status, id]);
    }
    if (body.check_in) {
      await sql.run('UPDATE reservations SET check_in = ? WHERE group_id = ?', [body.check_in, id]);
    }
    if (body.check_out) {
      await sql.run('UPDATE reservations SET check_out = ? WHERE group_id = ?', [body.check_out, id]);
    }
    if (body.nights) {
      await sql.run('UPDATE reservations SET nights = ? WHERE group_id = ?', [body.nights, id]);
    }
    if (body.source) {
      await sql.run('UPDATE reservations SET source = ? WHERE group_id = ?', [body.source, id]);
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return serverError('modules/bookings/api/group-booking updateGroupBooking', e);
  }
});

export const deleteGroupBooking = withPermission('manage_bookings', async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }, actor: Actor) => {
  try {
    const { id } = await params;
    const sql = getSql();

    if (!await ownedGroup(actor.organizationId, id)) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    await sql.run('DELETE FROM reservations WHERE group_id = ?', [id]);
    await sql.run('DELETE FROM reservation_groups WHERE id = ?', [id]);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return serverError('modules/bookings/api/group-booking deleteGroupBooking', e);
  }
});
