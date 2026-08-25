/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateGuestToken } from '@core/db';
import { money } from '@core/money';
import { getSql } from '@core/db/async';
import { withActor, withPermission } from '@core/auth/session';
import { serverError } from '@core/http/errors';

/**
 * GET /api/bookings/[id]/sub-bookings
 * List sub-bookings + line items for a reservation
 */
export const listSubBookings = withActor(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const sql = getSql();

    const reservation = await sql.row<any>('SELECT id FROM reservations WHERE id = ?', [id]);
    if (!reservation) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 });
    }

    const subBookings = await sql.rows<any>(`
      SELECT sb.*,
        cr.unit_id as child_unit_id,
        cr.status as child_status,
        cr.payment_status as child_payment_status,
        cr.guest_page_token as child_guest_page_token,
        u.name as child_unit_name, u.code as child_unit_code
      FROM reservation_sub_bookings sb
      LEFT JOIN reservations cr ON sb.child_reservation_id = cr.id
      LEFT JOIN units u ON cr.unit_id = u.id
      WHERE sb.reservation_id = ?
      ORDER BY sb.sort_order, sb.created_at
    `, [id]) as any[];

    // Attach line items to each sub-booking
    const result = await Promise.all(subBookings.map(async (sb: any) => ({
      ...sb,
      lineItems: await sql.rows<any>(`
        SELECT * FROM reservation_line_items
        WHERE sub_booking_id = ?
        ORDER BY sort_order
      `, [sb.id]),
    })));

    return NextResponse.json(result);
  } catch (e: any) {
    return serverError('modules/bookings/api/sub-bookings listSubBookings', e);
  }
});

/**
 * POST /api/bookings/[id]/sub-bookings
 * Create a sub-booking. If unitId is provided and differs from the master's
 * unit, a child reservation is auto-created to block that unit on the calendar.
 */
export const createSubBooking = withPermission('manage_bookings', async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const sql = getSql();
    const body = await request.json();

    const master = await sql.row<any>(`
      SELECT r.*, g.first_name, g.last_name
      FROM reservations r
      JOIN guests g ON r.guest_id = g.id
      WHERE r.id = ? AND r.parent_id IS NULL
    `, [id]) as any;
    if (!master) {
      return NextResponse.json({ error: 'Master reservation not found' }, { status: 404 });
    }

    const {
      label = '',
      unitId,
      adults = 1,
      children = 0,
      infants = 0,
      subtotal = 0,
      notes = null,
      lineItems = [],
    } = body;

    let childReservationId: string | null = null;

    // If sub-booking targets a DIFFERENT unit → create child reservation
    if (unitId && unitId !== master.unit_id) {
      // Check availability
      const overlap = await sql.row<any>(`
        SELECT 1 FROM reservations
        WHERE unit_id = ? AND status NOT IN ('cancelled', 'no_show')
          AND check_in < ? AND check_out > ?
        LIMIT 1
      `, [unitId, master.check_out, master.check_in]);
      if (overlap) {
        return NextResponse.json({ error: 'Цей юніт вже зайнятий на ці дати' }, { status: 409 });
      }

      childReservationId = `r_${Date.now()}_child`;
      const childToken = generateGuestToken();
      await sql.run(`
        -- organization_id, named rather than left to the column DEFAULT: that
        -- DEFAULT is a Postgres mechanism (migration 0005) and on SQLite the
        -- row landed with a NULL tenant. From the master booking, so a
        -- sub-booking can never belong to a different hotel than its parent.
        INSERT INTO reservations (
          id, organization_id, property_id, unit_id, guest_id, parent_id,
          check_in, check_out, nights, adults, children, infants,
          status, payment_status, source, total_price, currency,
          guest_page_token, notes
        )
        VALUES (?, (SELECT organization_id FROM properties WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [childReservationId, master.property_id, master.property_id, unitId, master.guest_id, master.id,
        master.check_in, master.check_out, master.nights, adults, children, infants,
        master.status, master.payment_status, master.source, subtotal, master.currency,
        childToken, `Sub-booking: ${label}`]);
    }

    // Create sub-booking record
    const subId = `sub_${Date.now()}`;
    const maxOrder = (await sql.row<any>('SELECT COALESCE(MAX(sort_order), -1) as mx FROM reservation_sub_bookings WHERE reservation_id = ?', [id]) as any).mx;

    await sql.run(`
      INSERT INTO reservation_sub_bookings (
        id, reservation_id, child_reservation_id, label,
        adults, children, infants, subtotal, notes, sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [subId, id, childReservationId, label, adults, children, infants, subtotal, notes, maxOrder + 1]);

    // Create line items if provided
    if (Array.isArray(lineItems) && lineItems.length > 0) {
      // All the items together: a sub-booking with half its lines priced
      // is worse than one with none.
      await sql.tx(async (t) => {
        for (let i = 0; i < lineItems.length; i++) {
          const item = lineItems[i];
          const itemId = `li_${Date.now()}_${i}`;
          const itemTotal = money(item.total ?? (item.quantity || 1) * (item.unit_price || 0));
          await t.run(`
          INSERT INTO reservation_line_items (
            id, sub_booking_id, description, quantity, unit_price, total, category, sort_order
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [itemId, subId, item.description || '', item.quantity || 1,
            item.unit_price || 0, itemTotal, item.category || 'other', i]);
        }
      });
    }

    return NextResponse.json({ id: subId, childReservationId }, { status: 201 });
  } catch (e: any) {
    console.error('POST sub-booking error:', e);
    return serverError('modules/bookings/api/sub-bookings createSubBooking', e);
  }
});

/**
 * PATCH /api/bookings/[id]/sub-bookings/[subId]
 * Update sub-booking metadata (label, adults, children, subtotal, notes)
 */
export const updateSubBooking = withPermission('manage_bookings', async (request: NextRequest, { params }: { params: Promise<{ id: string; subId: string }> }) => {
  try {
    const { id, subId } = await params;
    const sql = getSql();
    const body = await request.json();

    const existing = await sql.row<any>('SELECT * FROM reservation_sub_bookings WHERE id = ? AND reservation_id = ?', [subId, id]) as any;
    if (!existing) {
      return NextResponse.json({ error: 'Sub-booking not found' }, { status: 404 });
    }

    const allowed = ['label', 'adults', 'children', 'infants', 'subtotal', 'notes', 'sort_order'];
    const sets: string[] = [];
    const values: any[] = [];
    for (const key of allowed) {
      if (body[key] !== undefined) {
        sets.push(`${key} = ?`);
        values.push(body[key]);
      }
    }

    if (sets.length > 0) {
      values.push(subId);
      await sql.run(`UPDATE reservation_sub_bookings SET ${sets.join(', ')} WHERE id = ?`, [...values]);
    }

    // If child reservation exists, sync adults/children/subtotal
    if (existing.child_reservation_id) {
      const childUpdates: string[] = [];
      const childValues: any[] = [];
      if (body.adults !== undefined) { childUpdates.push('adults = ?'); childValues.push(body.adults); }
      if (body.children !== undefined) { childUpdates.push('children = ?'); childValues.push(body.children); }
      if (body.infants !== undefined) { childUpdates.push('infants = ?'); childValues.push(body.infants); }
      if (body.subtotal !== undefined) { childUpdates.push('total_price = ?'); childValues.push(body.subtotal); }
      if (childUpdates.length > 0) {
        childValues.push(existing.child_reservation_id);
        await sql.run(`UPDATE reservations SET ${childUpdates.join(', ')} WHERE id = ?`, [...childValues]);
      }
    }

    // Handle line items update (replace all)
    if (body.lineItems !== undefined && Array.isArray(body.lineItems)) {
      await sql.run('DELETE FROM reservation_line_items WHERE sub_booking_id = ?', [subId]);
      // All the items together: a sub-booking with half its lines priced
      // is worse than one with none.
      await sql.tx(async (t) => {
        for (let i = 0; i < body.lineItems.length; i++) {
          const item = body.lineItems[i];
          const itemId = `li_${Date.now()}_${i}`;
          const itemTotal = money(item.total ?? (item.quantity || 1) * (item.unit_price || 0));
          await t.run(`
          INSERT INTO reservation_line_items (
            id, sub_booking_id, description, quantity, unit_price, total, category, sort_order
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [itemId, subId, item.description || '', item.quantity || 1,
            item.unit_price || 0, itemTotal, item.category || 'other', i]);
        }
      });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return serverError('modules/bookings/api/sub-bookings updateSubBooking', e);
  }
});

/**
 * DELETE /api/bookings/[id]/sub-bookings/[subId]
 * Delete sub-booking + its child reservation (if any) + cascade line items
 */
export const deleteSubBooking = withPermission('manage_bookings', async (_request: NextRequest, { params }: { params: Promise<{ id: string; subId: string }> }) => {
  try {
    const { id, subId } = await params;
    const sql = getSql();

    const existing = await sql.row<any>('SELECT * FROM reservation_sub_bookings WHERE id = ? AND reservation_id = ?', [subId, id]) as any;
    if (!existing) {
      return NextResponse.json({ error: 'Sub-booking not found' }, { status: 404 });
    }

    // Delete child reservation if exists (cascade will clean up line items via FK)
    if (existing.child_reservation_id) {
      await sql.run('DELETE FROM reservations WHERE id = ? AND parent_id = ?', [existing.child_reservation_id, id]);
    }

    // Delete sub-booking (line items cascade via FK ON DELETE CASCADE)
    await sql.run('DELETE FROM reservation_sub_bookings WHERE id = ?', [subId]);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return serverError('modules/bookings/api/sub-bookings deleteSubBooking', e);
  }
});
