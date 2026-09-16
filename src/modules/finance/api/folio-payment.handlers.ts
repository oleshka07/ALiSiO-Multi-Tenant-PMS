/**
 * Оплата в рахунок гостя — через HTTP, з боку фінансів.
 *
 * ── Чому обробник живе ТУТ, а не в `@invoicing` ─────────────────────────
 *
 * Бо ці двері пишуть у ДВІ книги, і друга з них — каса (`fin_operations`),
 * якою володіє цей модуль. Зворотного напрямку немає за правилом: жоден файл
 * `@invoicing` не має права імпортувати `@finance` — це стверджує сам
 * `invoicing.check.ts`, і `check-boundaries` тримає стелю. Тож або
 * композиція тут, або дві книги знову пишуться порізно.
 *
 * Варта лишається ТА САМА, що була на цьому маршруті: модуль `invoicing` і
 * право `manage_documents`. Це не «фінансова» дія: прийняти гроші в рахунок
 * гостя — робота рецепції, і фінансового пароля вона не потребує.
 *
 * Адреса не змінилась (`POST /api/finance/folios/<id>/payments`) — вона й
 * раніше стояла під `/api/finance`.
 */
import { NextResponse } from 'next/server';
import { withModule } from '@core/auth/session';
import { handleError } from '@core/http/errors';
import { settleFolioPayment } from './payment-bridge';
import { getOptionalActor } from './operations.handlers';

export const addFolioPayment = withModule('invoicing', 'manage_documents', async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  actor,
) => {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const result = await settleFolioPayment({
      folioId: id,
      amount: Number(body.amount),
      method: body.method === undefined || body.method === null ? undefined : String(body.method),
      // Рядок довідника способів оплати (Д61). Доти його не передавав ніхто:
      // писач приймав `methodId` з першого дня, а по HTTP він був недосяжний,
      // тож увесь довідник лишався мертвим.
      methodId: typeof body.method_id === 'string' && body.method_id.trim() ? body.method_id.trim() : null,
      invoiceId: typeof body.invoice_id === 'string' && body.invoice_id.trim() ? body.invoice_id.trim() : null,
      paidAt: typeof body.paid_at === 'string' && body.paid_at.trim() ? body.paid_at.trim() : null,
      // Хто взяв гроші — факт сесії, ніколи не твердження клієнта.
      receivedBy: actor.user.id,
      actor: await getOptionalActor(),
    });
    return NextResponse.json({
      id: result.paymentId,
      operation_id: result.operationId,
      reservation_id: result.reservationId,
      // Слово броні порахував СЕРВЕР. Доти його рахував браузер окремим
      // `PATCH`, який вимагає іншого права: у бухгалтера він віддавав 403, і
      // оплата мовчки лишала бронь «не оплаченою».
      payment_status: result.paymentStatus,
      // Готівка, яка не дійшла до каси (немає рахунку в цій валюті), — це не
      // збій запиту: платіж гостя записано. Але й не мовчання: причина їде
      // оператору дослівно, як `folioRefusal` у рецепційних дверях.
      ...(result.tillRefusal ? { till_refusal: result.tillRefusal } : {}),
    }, { status: 201 });
  } catch (e) {
    // Названа відмова (клас оплати, фіскальна варта, чужий рахунок) їде своїм
    // текстом і статусом; решта — 500 без подробиць драйвера (інваріант 6).
    return handleError('modules/finance/api/folio-payment addFolioPayment', e);
  }
});
