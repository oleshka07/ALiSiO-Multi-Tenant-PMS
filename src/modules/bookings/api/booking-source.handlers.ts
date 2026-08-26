/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { serverError } from '@core/http/errors';
import { withActor, type Actor } from '@core/auth/session';

/**
 * A sales channel belongs to a hotel, and only that hotel may edit it.
 *
 * Both handlers here used to be plain exported functions: no guard, and
 * `WHERE id = ?` with nothing about the organization. The route file exports
 * them straight as PUT and DELETE. What stood in front was the middleware,
 * which only asks whether a session cookie exists — so any logged-in user of
 * any hotel on the server could rename another hotel's channel, set its
 * commission to zero, or delete it. `commission_percent` is read straight into
 * the commission of every new booking (reservations.handlers.ts), so this was
 * money, not cosmetics.
 *
 * check-route-guards did not notice: its PUBLIC pattern ends the alternative
 * with `\b`, and a word boundary matches the hyphen, so `/api/booking-sources`
 * was read as a public `/api/booking` route and skipped. That is fixed in the
 * gate as well — this file is the reason it was found.
 *
 * `booking_sources` carries `property_id`, not `organization_id`, so the scope
 * is the same subquery the list handler next door already uses.
 */
const OWNED = 'property_id IN (SELECT id FROM properties WHERE organization_id = ?)';

export const updateBookingSource = withActor(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  actor: Actor,
) => {
  try {
    const { id } = await params;
    const sql = getSql();
    const body = await request.json();
    const { name, code, icon_letter, color, sort_order, is_active, commission_percent } = body;

    const existing = await sql.row<any>(
      `SELECT * FROM booking_sources WHERE id = ? AND ${OWNED}`, [id, actor.organizationId]) as any;
    if (!existing) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    if (code && code !== existing.code) {
      // Codes are unique per hotel, so the duplicate check is per hotel too:
      // unscoped, another tenant's code blocked a name this one may use.
      const dup = await sql.row<any>(
        `SELECT id FROM booking_sources WHERE code = ? AND id != ? AND ${OWNED}`,
        [code, id, actor.organizationId]);
      if (dup) {
        return NextResponse.json({ error: 'Source code already exists' }, { status: 400 });
      }
    }

    await sql.run(`
      UPDATE booking_sources SET
        name = ?, code = ?, icon_letter = ?, color = ?, sort_order = ?, is_active = ?,
        commission_percent = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND ${OWNED}
    `, [name ?? existing.name,
      code ?? existing.code,
      icon_letter ?? existing.icon_letter,
      color ?? existing.color,
      sort_order ?? existing.sort_order,
      is_active ?? existing.is_active,
      commission_percent ?? existing.commission_percent ?? 0,
      id, actor.organizationId]);

    const updated = await sql.row<any>(
      `SELECT * FROM booking_sources WHERE id = ? AND ${OWNED}`, [id, actor.organizationId]);
    return NextResponse.json(updated);
  } catch (e: any) {
    return serverError('modules/bookings/api/booking-source updateBookingSource', e);
  }
});

export const deleteBookingSource = withActor(async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
  actor: Actor,
) => {
  try {
    const { id } = await params;
    const sql = getSql();

    const existing = await sql.row<any>(
      `SELECT * FROM booking_sources WHERE id = ? AND ${OWNED}`, [id, actor.organizationId]) as any;
    if (!existing) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    // Only this hotel's bookings count: another tenant using the same code
    // (`direct`, `booking_com`) is not a reason to refuse the deletion here.
    const usageCount = await sql.row<any>(`
      SELECT COUNT(*) as cnt FROM reservations r
      JOIN properties p ON r.property_id = p.id
      WHERE r.source = ? AND p.organization_id = ?
    `, [existing.code, actor.organizationId]) as any;

    if (usageCount?.cnt > 0) {
      return NextResponse.json(
        { error: `Неможливо видалити: ${usageCount.cnt} бронювань використовують це джерело` },
        { status: 400 }
      );
    }

    await sql.run(
      `DELETE FROM booking_sources WHERE id = ? AND ${OWNED}`, [id, actor.organizationId]);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return serverError('modules/bookings/api/booking-source deleteBookingSource', e);
  }
});
