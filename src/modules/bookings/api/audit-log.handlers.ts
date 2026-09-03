/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSql } from '@core/db/async';
import { getSessionUser } from '@core/auth';
import { withActor, type Actor } from '@core/auth/session';
import { serverError } from '@core/http/errors';
import { ownedReservation } from '../data/owned.repo';
import { recordBookingChange, bookingLabel } from '../data/booking-history.repo';

/** Ролі, яким видно історію змін броні. Те саме правило — на картці (`canSeeHistory`). */
export const HISTORY_ROLES = new Set(['owner', 'director', 'manager']);

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
  return bookingLabel(getSql(), reservationId);
}

/** Write an audit entry to booking_activity_log — through the module door. */
export async function writeBookingAudit(
  reservationId: string,
  action: string,
  details: string,
  actor: { id: string; name: string } | null,
  beforeRow: any,
  afterRow: any,
  bookingLabel?: string,
): Promise<void> {
  await recordBookingChange(getSql(), {
    reservationId, action, details,
    actor: actor ? { id: actor.id, name: actor.name } : null,
    before: beforeRow ?? undefined, after: afterRow ?? undefined,
    bookingLabel,
  });
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
    // Історію читає адміністрація готелю: власник, директор, менеджер.
    // Була лише власнику — а користується нею рецепція старшої зміни
    // («хто пересунув заїзд?») і саме її показують рецензенту каналу.
    const store = await cookies();
    const sessionId = store.get('session_id')?.value;
    const user = await getSessionUser(sessionId);
    if (!user || !HISTORY_ROLES.has(user.role)) {
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
