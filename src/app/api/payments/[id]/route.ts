import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@core/auth/session';
import { deletePaymentOperation } from '@/modules/finance/api/payment-bridge';
import { serverError } from '@core/http/errors';

// Legacy DELETE /api/payments/:id — deletes the fin_operations row.
// Deleting a payment is money leaving the books, so it needs the permission
// that recording one needs — and, like every guard here, a tenant, without
// which the fin_operations lookup below matches nothing on Postgres.
//
// Р8.7: одні двері з видаленням операції у Фінансах. Доти цей маршрут чистив
// `fin_operations` власним SQL і кликав перерахунок — а той читає ФОЛІО, де
// платіж лишався: рядок зникав, слово броні лишалось «оплачено», виселення
// відчинене. Тепер видаляє `deletePaymentOperation`, і гроші знімаються з
// обох книг разом (тримає `check-payment-delete --strict`).
export const DELETE = withPermission('manage_payments', async (
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  try {
    const { id } = await context.params;
    const { deleted } = await deletePaymentOperation(id);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, deleted_id: id });
  } catch (e: unknown) {
    return serverError('app/api/payments/[id] DELETE', e);
  }
});
