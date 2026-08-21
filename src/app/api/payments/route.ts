/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { createPaymentOperation } from '@/modules/finance/api/payment-bridge';
import { getOptionalActor } from '@/modules/finance/api/operations.handlers';
import { withActor, withPermission, type Actor } from '@core/auth/session';

// Legacy /api/payments endpoint — reads/writes via fin_operations.
//
// The endpoint REQUIRES either reservation_id or group_id. Without a filter
// it used to return every payment system-wide (dump-all bug surfaced when
// GroupViewModal called it with group_id which was silently ignored).
//
// As of clean-3 there are no signal vs real duplicates any more — every
// fin_operation row represents real money. The dedup logic that used to
// live here is gone with the is_pms_signal column.
export const GET = withActor(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const sql = getSql();
    const { searchParams } = new URL(request.url);
    const reservationId = searchParams.get('reservation_id');
    const groupId = searchParams.get('group_id');
    const parentId = searchParams.get('parent_id');

    if (!reservationId && !groupId && !parentId) {
      return NextResponse.json(
        { error: 'reservation_id, parent_id, or group_id query param is required' },
        { status: 400 },
      );
    }

    const where: string[] = ["o.reservation_id IS NOT NULL", "o.status = 'completed'", 'o.organization_id = ?'];
    const params: any[] = [actor.organizationId];
    if (reservationId) {
      // Include payments for this reservation AND all its children
      where.push('(o.reservation_id = ? OR o.reservation_id IN (SELECT id FROM reservations WHERE parent_id = ?))');
      params.push(reservationId, reservationId);
    } else if (parentId) {
      where.push('(o.reservation_id = ? OR o.reservation_id IN (SELECT id FROM reservations WHERE parent_id = ?))');
      params.push(parentId, parentId);
    } else if (groupId) {
      // Legacy: group_id from old reservation_groups
      where.push('o.reservation_id IN (SELECT id FROM reservations WHERE group_id = ?)');
      params.push(groupId);
    }

    const rows = await sql.rows<any>(`
      SELECT o.id, o.reservation_id, o.amount, o.currency, o.method,
             o.payment_subtype AS type,
             o.status, o.paid_at, o.comment AS notes, o.source_ref,
             o.op_type
      FROM fin_operations o
      WHERE ${where.join(' AND ')}
      ORDER BY o.paid_at DESC
    `, params);
    return NextResponse.json(rows);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
});

// Methods that represent real money in our hands at the moment of click —
// only `cash` qualifies. Card / bank / platform / invoice / online are
// PMS-side markers: the actual money still has to arrive via a
// bank statement import or a channel statement, and creating a fin_operation
// here would double-count the same money once the real source lands.
const CASH_METHODS = new Set(['cash']);

// Guarded, like the GET above it — this one records money and was not.
//
// `manage_payments` rather than a bare session: taking a cash payment writes a
// fin_operation against a real account. Without a guard there was no permission
// check and, on Postgres, no tenant either — so the reservation lookup below
// matched nothing and the payment failed after the guest had handed over cash.
export const POST = withPermission('manage_payments', async (
  request: NextRequest,
): Promise<NextResponse> => {
  try {
    const sql = getSql();
    const body = await request.json();
    const { reservation_id, amount, method = 'cash', type = 'partial', notes, paid_at } = body;
    if (!reservation_id || !amount) {
      return NextResponse.json({ error: 'reservation_id and amount are required' }, { status: 400 });
    }

    // Cash on hand → real money, create the fin_operation as before.
    // Capture who recorded it (Andriy taking cash at check-in shows up
    // attributed to him in the operations audit log, not anonymous).
    if (CASH_METHODS.has(method)) {
      const actor = await getOptionalActor();

      // Route to the logged-in user's personal cash account.
      // Each admin has a default_cash_account_id in app_users (e.g. Андрій → 'Андріїв cash').
      // Without this, every cash payment falls to the first cash account by sort_order (Олег's).
      let accountId: string | undefined;
      if (actor?.id) {
        const userRow = await sql.row<{ default_cash_account_id: string | null }>(
          'SELECT default_cash_account_id FROM app_users WHERE id = ?',
          [actor.id],
        );
        accountId = userRow?.default_cash_account_id || undefined;
      }

      const formattedComment = actor?.name
        ? `Внесено: ${actor.name}${notes ? ' · ' + notes : ''}`
        : (notes || null);

      const { operationId } = await createPaymentOperation({
        reservationId: reservation_id,
        amount: Math.abs(Number(amount)),
        method,
        paymentSubtype: type,
        source: 'manual',
        status: 'completed',
        paidAt: paid_at || new Date().toISOString(),
        comment: formattedComment,
        actor,
        accountId,
      });
      return NextResponse.json({ id: operationId, ok: true, kind: 'fin_operation' }, { status: 201 });
    }

    // Marker path — no fin_operation. Only update reservation.payment_status
    // and write an audit row to booking_activity_log so the operator has a
    // trail of who marked what.
    const res = await sql.row<{ id: string; total_price: number; payment_status: string; is_prepaid: number }>(
      'SELECT id, total_price, payment_status, is_prepaid FROM reservations WHERE id = ?',
      [reservation_id],
    );
    if (!res) return NextResponse.json({ error: 'reservation not found' }, { status: 404 });

    // Channel-prepaid reservations (Hostex Booking/Airbnb/VRBO with is_prepaid=1)
    // are paid by the platform — never downgrade their status from a marker.
    let statusChanged = false;
    if (res.is_prepaid !== 1) {
      let nextStatus = res.payment_status;
      if (type === 'full')              nextStatus = 'paid';
      else if (type === 'refund')       nextStatus = 'unpaid';
      else if (type === 'deposit')      nextStatus = 'partial';
      else if (type === 'partial')      nextStatus = 'partial';
      if (nextStatus !== res.payment_status) {
        await sql.run(
          'UPDATE reservations SET payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [nextStatus, reservation_id],
        );
        statusChanged = true;
      }
    }

    try {
      const detailsLine = `${method} ${type} ${Math.abs(Number(amount))}${notes ? ' — ' + notes : ''}`;
      await sql.run(
        // organization_id from the reservation the payment is against.
        `INSERT INTO booking_activity_log (id, organization_id, reservation_id, action, details)
         VALUES (?, (SELECT organization_id FROM reservations WHERE id = ?), ?, 'payment_marker', ?)`,
        [`al_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, reservation_id, reservation_id, detailsLine],
      );
    } catch { /* non-critical */ }

    return NextResponse.json({
      ok: true,
      kind: 'marker',
      method,
      statusChanged,
      message:
        'Позначка збережена. Реальна транзакція з\'явиться в Операціях, коли надійдуть гроші (банк / платформа).',
    }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
});
