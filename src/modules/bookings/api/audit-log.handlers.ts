/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSql } from '@core/db/async';
import { getSessionUser } from '@core/auth';
import { withActor, type Actor } from '@core/auth/session';
import { serverError } from '@core/http/errors';
import { ownedReservation } from '../data/owned.repo';

/** Actor helper — same pattern as finance module's getOptionalActor */
export async function getBookingActor(): Promise<{ id: string; name: string } | null> {
  try {
    const store = await cookies();
    const sessionId = store.get('session_id')?.value;
    const user = await getSessionUser(sessionId);
    if (!user) return null;
    return { id: user.id, name: user.full_name };
  } catch { return null; }
}

/** Build a human-readable label for a booking that survives deletion */
export async function buildBookingLabel(reservationId: string): Promise<string> {
  const sql = getSql();
  try {
    const row = await sql.row<any>(`
      SELECT r.check_in, r.check_out, r.source, u.code as unit_code,
             g.first_name, g.last_name
      FROM reservations r
      LEFT JOIN guests g ON r.guest_id = g.id
      LEFT JOIN units u ON r.unit_id = u.id
      WHERE r.id = ?
    `, [reservationId]) as any;
    if (!row) return reservationId;
    return `${row.first_name || ''} ${row.last_name || ''} · ${row.unit_code || ''} · ${row.check_in}–${row.check_out}`.trim();
  } catch { return reservationId; }
}

/** Write an audit entry to booking_activity_log */
export async function writeBookingAudit(
  reservationId: string,
  action: string,
  details: string,
  actor: { id: string; name: string } | null,
  beforeRow: any,
  afterRow: any,
  bookingLabel?: string,
): Promise<void> {
  const sql = getSql();
  const id = `bal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    const label = bookingLabel || await buildBookingLabel(reservationId);
    await sql.run(`
      -- organization_id, from the reservation this entry is about. Left to
      -- the column DEFAULT it was NULL on SQLite, and an audit entry no tenant
      -- can read is an audit entry that does not exist.
      INSERT INTO booking_activity_log
        (id, organization_id, reservation_id, action, details, user_id, user_name, before_json, after_json, booking_label)
      VALUES (?, (SELECT organization_id FROM reservations WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, reservationId, reservationId, action, details,
      actor?.id || null, actor?.name || null,
      beforeRow ? JSON.stringify(beforeRow) : null,
      afterRow ? JSON.stringify(afterRow) : null,
      label]);
  } catch (e: any) {
    console.error('[booking_activity_log] write failed (non-fatal):', e?.message);
  }
}

/**
 * GET /api/audit/bookings — owner-only audit trail, of this hotel's bookings.
 *
 * «Owner» was the only check. `role === 'owner'` is true for the owner of every
 * hotel on the server, and the query named no organization at all — so with no
 * `reservation_id` this returned EVERY entry from EVERY tenant, and each entry
 * carries `before_json` and `after_json`: complete row snapshots of other
 * hotels' reservations, guest ids, prices, notes and internal notes included.
 * A single GET with no parameters was the widest read in the application.
 *
 * The actor now supplies the organization, and `reservation_id` is checked
 * against it too — otherwise the filtered path would still answer for a
 * booking id belonging to somebody else.
 */
export const listBookingAudit = withActor(async (request: NextRequest, _ctx: unknown, actor: Actor): Promise<NextResponse> => {
  try {
    // Auth check: owner only
    const store = await cookies();
    const sessionId = store.get('session_id')?.value;
    const user = await getSessionUser(sessionId);
    if (!user || user.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const sql = getSql();
    const { searchParams } = new URL(request.url);
    const reservationId = searchParams.get('reservation_id');
    const limit = Math.min(200, parseInt(searchParams.get('limit') || '50', 10));
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    let statement = `
      SELECT id, reservation_id, action, details, user_id, user_name,
             before_json, after_json, booking_label, created_at
      FROM booking_activity_log
      WHERE organization_id = ?
    `;
    const params: any[] = [actor.organizationId];

    if (reservationId) {
      // Asking about one booking still has to be a booking of this hotel's.
      if (!await ownedReservation(actor.organizationId, reservationId)) {
        return NextResponse.json({ items: [] });
      }
      statement += ' AND reservation_id = ?';
      params.push(reservationId);
    }

    statement += ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = await sql.rows<any>(statement, params);
    return NextResponse.json({ items: rows });
  } catch (error: any) {
    console.error('GET /api/audit/bookings error:', error?.message || error);
    return serverError('modules/bookings/api/audit-log listBookingAudit', error, 'Failed');
  }
});
