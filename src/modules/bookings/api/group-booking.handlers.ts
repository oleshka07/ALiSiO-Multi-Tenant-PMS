/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';

export async function getGroupBooking(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sql = getSql();

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
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function updateGroupBooking(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sql = getSql();
    const body = await request.json();

    const existing = await sql.row<any>('SELECT * FROM reservation_groups WHERE id = ?', [id]) as any;
    if (!existing) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
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
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function deleteGroupBooking(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sql = getSql();

    await sql.run('DELETE FROM reservations WHERE group_id = ?', [id]);
    await sql.run('DELETE FROM reservation_groups WHERE id = ?', [id]);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
