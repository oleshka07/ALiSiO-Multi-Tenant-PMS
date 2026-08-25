/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import { findOrCreateGuest } from '@guests';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { withActor, withPermission } from '@core/auth/session';
import { serverError } from '@core/http/errors';

export const listGroupBookings = withActor(async () => {
  try {
    const sql = getSql();
    const groups = await sql.rows<any>(`
      SELECT rg.*,
        g.first_name, g.last_name, g.email as guest_email, g.phone as guest_phone,
        b.name as building_name, b.code as building_code,
        (SELECT COUNT(*) FROM reservations WHERE group_id = rg.id) as room_count
      FROM reservation_groups rg
      JOIN guests g ON rg.guest_id = g.id
      LEFT JOIN buildings b ON rg.building_id = b.id
      ORDER BY rg.created_at DESC
    `);
    return NextResponse.json(groups);
  } catch (e: any) {
    return serverError('modules/bookings/api/group-bookings listGroupBookings', e);
  }
});

export const createGroupBooking = withPermission('manage_bookings', async (request: NextRequest) => {
  try {
    const sql = getSql();
    const body = await request.json();
    const {
      firstName, lastName, email, phone,
      groupType, buildingId, unitIds,
      checkIn, checkOut, totalPrice, source, notes,
    } = body;

    if (!firstName || !lastName || !checkIn || !checkOut) {
      return NextResponse.json({ error: "Обов'язкові поля: ім'я, прізвище, дати" }, { status: 400 });
    }

    let finalUnitIds: string[] = unitIds || [];

    if (groupType === 'building' && buildingId) {
      const buildingUnits = await sql.rows<any>('SELECT id FROM units WHERE building_id = ? AND is_active = TRUE ORDER BY sort_order', [buildingId]) as { id: string }[];
      finalUnitIds = buildingUnits.map(u => u.id);
    }

    if (finalUnitIds.length === 0) {
      return NextResponse.json({ error: 'Не обрано жодної кімнати' }, { status: 400 });
    }

    // Pre-check overlap for ALL units up-front. Without this, the loop below
    // would either rely on the prevent_overbooking trigger (which aborts the
    // transaction mid-group, leaving partial state) or silently overbook if
    // units come from external sync sources that bypass it. Better to fail
    // the whole request with a clear conflict report than to half-create.
    const overlapPlaceholders = finalUnitIds.map(() => '?').join(',');
    const conflicts = await sql.rows<any>(`
      SELECT r.unit_id, u.code as unit_code, u.name as unit_name,
             r.id as conflict_id, r.check_in, r.check_out, r.status
      FROM reservations r
      JOIN units u ON u.id = r.unit_id
      WHERE r.unit_id IN (${overlapPlaceholders})
        AND r.status NOT IN ('cancelled', 'no_show')
        AND r.check_in < ? AND r.check_out > ?
    `, [...finalUnitIds, checkOut, checkIn]) as any[];
    if (conflicts.length > 0) {
      return NextResponse.json(
        {
          error: 'Один або кілька юнітів вже зайняті на ці дати',
          conflicts: conflicts.map((c) => ({
            unitCode: c.unit_code,
            unitName: c.unit_name,
            conflictReservationId: c.conflict_id,
            checkIn: c.check_in,
            checkOut: c.check_out,
            status: c.status,
          })),
        },
        { status: 409 },
      );
    }

    const nights = Math.max(1, Math.floor(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000
    ));

    const org = { id: await requireOrganizationId() } as any;
    const firstUnit = await sql.row<any>('SELECT property_id FROM units WHERE id = ?', [finalUnitIds[0]]) as any;
    if (!firstUnit) {
      return NextResponse.json({ error: 'Unit not found' }, { status: 400 });
    }

    const guestId = (await findOrCreateGuest({
      organizationId: org.id,
      firstName,
      lastName,
      email: email || null,
      phone: phone || null,
    })).id;

    const groupId = `grp_${Date.now()}`;
    await sql.run(`
      INSERT INTO reservation_groups (id, property_id, guest_id, group_type, building_id, check_in, check_out, nights, total_price, source, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [groupId, firstUnit.property_id, guestId, groupType || 'custom', buildingId || null, checkIn, checkOut, nights, totalPrice || 0, source || 'direct', notes || null]);

    const pricePerUnit = finalUnitIds.length > 0 ? Math.round((totalPrice || 0) / finalUnitIds.length) : 0;
    const createdResIds: string[] = [];
    // A group booking is one booking to the guest: either every room is
    // reserved or none is, or the group has rooms it did not ask for.
    await sql.tx(async (t) => {
      for (let i = 0; i < finalUnitIds.length; i++) {
        const resId = `r_${Date.now()}_${i}`;
        await t.run(`
          -- organization_id, named rather than left to the column DEFAULT:
          -- that DEFAULT is a Postgres mechanism (migration 0005) and on
          -- SQLite the row landed with a NULL tenant.
          INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id, group_id, check_in, check_out, nights, adults, children, status, payment_status, source, total_price)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [resId, org.id, firstUnit.property_id, finalUnitIds[i], guestId, groupId, checkIn, checkOut, nights, 1, 0, 'confirmed', 'unpaid', source || 'direct', pricePerUnit]);
        createdResIds.push(resId);
      }
    });

    return NextResponse.json({ id: groupId, guestId, roomCount: finalUnitIds.length }, { status: 201 });
  } catch (e: any) {
    console.error('POST /api/group-bookings error:', e);
    return serverError('modules/bookings/api/group-bookings createGroupBooking', e);
  }
});
