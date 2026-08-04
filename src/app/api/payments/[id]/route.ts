import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { recalcReservationPaymentStatus } from '@/modules/finance/api/operations.handlers';

// Legacy DELETE /api/payments/:id — deletes the fin_operations row.
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
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
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
