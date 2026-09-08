import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@core/auth/session';
import { deletePaymentOperation } from '@/modules/finance/api/payment-bridge';
// `handleError`, не `serverError`: відмова, названа на місці кидання
// (`refuse`, примітив Ц43), мусить дійти до портьє СВОЇМ текстом і своїм
// статусом. Доти цей `catch` згортав її в 500 «Внутрішня помилка сервера»,
// а причина — «income requires account_to_id» — лишалась у лозі контейнера
// (INC-028, ланка 3; клас Р8.3). `handleError` віддає 500 усьому, що не є
// відмовою, тож деталі драйвера клієнтові й далі не їдуть (інваріант 6).
import { handleError } from '@core/http/errors';

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
    return handleError('app/api/payments/[id] DELETE', e);
  }
});
