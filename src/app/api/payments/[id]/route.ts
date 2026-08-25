import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { withPermission } from '@core/auth/session';
import { recalcReservationPaymentStatus } from '@/modules/finance/api/operations.handlers';
import { serverError } from '@core/http/errors';

// Legacy DELETE /api/payments/:id — deletes the fin_operations row.
// Deleting a payment is money leaving the books, so it needs the permission
// that recording one needs — and, like every guard here, a tenant, without
// which the fin_operations lookup below matches nothing on Postgres.
export const DELETE = withPermission('manage_payments', async (
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  try {
    const sql = getSql();
    const { id } = await context.params;
    const op = await sql.row<any>("SELECT reservation_id FROM fin_operations WHERE id = ?", [id]);
    if (!op) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await sql.run('UPDATE bank_transactions SET matched_operation_id = NULL WHERE matched_operation_id = ?', [id]);
    await sql.run('DELETE FROM fin_operations WHERE id = ?', [id]);
    if (op.reservation_id) await recalcReservationPaymentStatus(op.reservation_id);
    return NextResponse.json({ ok: true, deleted_id: id });
  } catch (e: any) {
    return serverError('app/api/payments/[id] DELETE', e);
  }
});
