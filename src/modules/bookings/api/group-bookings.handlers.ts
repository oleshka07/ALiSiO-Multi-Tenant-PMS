/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import { findOrCreateGuest } from '@guests';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { withActor, withPermission, type Actor } from '@core/auth/session';
import { serverError } from '@core/http/errors';
import { ownedUnit } from '../data/owned.repo';

/**
 * Group bookings: one party, many rooms, one reservation_groups row.
 *
 * `reservation_groups` reaches its tenant through `property_id`, and neither
 * handler here mentioned it. The list returned every group on the server with
 * the guest's name, email and phone attached; creation took `unitIds` and
 * `buildingId` straight from the request body, so a group could be written
 * against another hotel's rooms — and `firstUnit.property_id`, read from the
 * first of those rooms, then filed the whole group under that hotel.
 */

export const listGroupBookings = withActor(async (_request: NextRequest, _ctx: unknown, actor: Actor) => {
  try {
    const sql = getSql();
    const groups = await sql.rows<any>(`
      SELECT rg.*,
        g.first_name, g.last_name, g.email as guest_email, g.phone as guest_phone,
        b.name as building_name, b.code as building_code,
        (SELECT COUNT(*) FROM reservations WHERE group_id = rg.id) as room_count
      FROM reservation_groups rg
      JOIN guests g ON rg.guest_id = g.id
      JOIN properties p ON rg.property_id = p.id
      LEFT JOIN buildings b ON rg.building_id = b.id
      WHERE p.organization_id = ?
      ORDER BY rg.created_at DESC
    `, [actor.organizationId]);
    return NextResponse.json(groups);
  } catch (e: any) {
    return serverError('modules/bookings/api/group-bookings listGroupBookings', e);
  }
});

export const createGroupBooking = withPermission('manage_bookings', async (request: NextRequest, _ctx: unknown, actor: Actor) => {
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
      // The building comes from the body too, so it is joined to properties:
      // otherwise «book the whole building» would happily expand to another
      // hotel's building and book every room in it.
      const buildingUnits = await sql.rows<any>(`
        SELECT u.id FROM units u
        JOIN properties p ON u.property_id = p.id
        WHERE u.building_id = ? AND u.is_active = TRUE AND p.organization_id = ?
        ORDER BY u.sort_order`, [buildingId, actor.organizationId]) as { id: string }[];
      finalUnitIds = buildingUnits.map(u => u.id);
    }

    if (finalUnitIds.length === 0) {
      return NextResponse.json({ error: 'Не обрано жодної кімнати' }, { status: 400 });
    }

    // Every room named in the body must be this hotel's. Without this the
    // group was written against the neighbour's inventory and then filed under
    // whichever property the FIRST of those rooms belonged to — so a booking
    // could appear in a hotel that never took it.
    for (const unitId of finalUnitIds) {
      if (!await ownedUnit(actor.organizationId, String(unitId))) {
        return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
      }
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
