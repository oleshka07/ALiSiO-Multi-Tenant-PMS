/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { withPermission } from '@core/auth/session';

export const assignGuest = withPermission('manage_bookings', async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id: groupId } = await params;
    const sql = getSql();
    const body = await request.json();
    const { reservationId, firstName, lastName, email, phone } = body;

    if (!reservationId || !firstName || !lastName) {
      return NextResponse.json({ error: "Обов'язкові поля: reservationId, ім'я, прізвище" }, { status: 400 });
    }

    const reservation = await sql.row<any>('SELECT id, guest_id FROM reservations WHERE id = ? AND group_id = ?', [reservationId, groupId]) as any;

    if (!reservation) {
      return NextResponse.json({ error: 'Reservation not found in this group' }, { status: 404 });
    }

    const org = { id: await requireOrganizationId() } as any;

    let guestId: string;
    if (email) {
      const existing = await sql.row<any>('SELECT id FROM guests WHERE email = ? AND organization_id = ?', [email, org.id]) as any;
      if (existing) {
        guestId = existing.id;
        await sql.run('UPDATE guests SET first_name = ?, last_name = ?, phone = COALESCE(?, phone), updated_at = CURRENT_TIMESTAMP WHERE id = ?', [firstName, lastName, phone || null, guestId]);
      } else {
        guestId = `g_${Date.now()}`;
        await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name, email, phone) VALUES (?, ?, ?, ?, ?, ?)', [guestId, org.id, firstName, lastName, email, phone || null]);
      }
    } else {
      guestId = `g_${Date.now()}`;
      await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name, phone) VALUES (?, ?, ?, ?, ?)', [guestId, org.id, firstName, lastName, phone || null]);
    }

    await sql.run('UPDATE reservations SET guest_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [guestId, reservationId]);

    return NextResponse.json({ success: true, guestId });
  } catch (e: any) {
    console.error('POST /api/group-bookings/[id]/assign-guest error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
});
