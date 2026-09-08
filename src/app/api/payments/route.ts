/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { createPaymentOperation } from '@/modules/finance/api/payment-bridge';
import { getOptionalActor } from '@/modules/finance/api/operations.handlers';
import { withActor, withPermission, type Actor } from '@core/auth/session';
// `handleError`, не `serverError`: відмова, названа на місці кидання
// (`refuse`, примітив Ц43), мусить дійти до портьє СВОЇМ текстом і своїм
// статусом. Доти цей `catch` згортав її в 500 «Внутрішня помилка сервера»,
// а причина — «income requires account_to_id» — лишалась у лозі контейнера
// (INC-028, ланка 3; клас Р8.3). `handleError` віддає 500 усьому, що не є
// відмовою, тож деталі драйвера клієнтові й далі не їдуть (інваріант 6).
import { handleError } from '@core/http/errors';

// Legacy /api/payments endpoint — reads/writes via fin_operations.
//
// Маршрут ВИМАГАЄ reservation_id або parent_id. Без фільтра він колись
// повертав усі платежі системи — це виявилось тоді, коли екран групи звався
// сюди з `group_id`, а маршрут його мовчки ігнорував.
//
// `group_id` як фільтр прибрано 2026-08-27 разом із групами (міграція 0039):
// колонки, за якою він фільтрував, більше немає, тож запит із ним падав би
// на неіснуючій колонці — а SQL це рядок, і tsc цього не бачить.
//
// As of clean-3 there are no signal vs real duplicates any more — every
// fin_operation row represents real money. The dedup logic that used to
// live here is gone with the is_pms_signal column.
export const GET = withActor(async (request: NextRequest, _ctx, actor: Actor) => {
  try {
    const sql = getSql();
    const { searchParams } = new URL(request.url);
    const reservationId = searchParams.get('reservation_id');
    const parentId = searchParams.get('parent_id');

    if (!reservationId && !parentId) {
      return NextResponse.json(
        { error: 'reservation_id or parent_id query param is required' },
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
    return handleError('app/api/payments GET', e);
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

      const { operationId, folioRecorded, folioRefusal } = await createPaymentOperation({
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
      // Відмова книги гостя ДОХОДИТЬ до оператора, а не лягає в лог (Р10.10).
      // Для німецького обʼєкта без `fiscal_de` це постійний стан цілого
      // сегмента: гроші в касі, у рахунку гостя їх немає. 201 без жодного
      // слова означав, що розходження книг бачить лише той, хто читає логи.
      return NextResponse.json({
        id: operationId, ok: true, kind: 'fin_operation',
        folioRecorded,
        ...(folioRecorded ? {} : {
          folioRefusal,
          message: 'Гроші записано в касу, але не в рахунок гостя — рахунок їх не покаже.',
        }),
      }, { status: 201 });
    }

    // ── Маркерний шлях: НІ операції, НІ рядка в книзі гостя (Ч8) ────────
    //
    // Рішення 07.09: маркер очікуваної оплати у фоліо не пише. «Очікується
    // переказ» лишається очікуванням на броні, видимим рецепції в журналі; ні
    // борг, ні слово оплати воно не рухає.
    //
    // Причини, у порядку ваги:
    //   - книга гостя містить ФАКТИ, не наміри (Д20/Ч7): гроші ще в дорозі, і
    //     цей маршрут існує саме тому (див. CASH_METHODS вище);
    //   - `fin_folio_payments` не має видалення за задумом — помилковий клік
    //     виправлявся б лише зустрічним рядком у рахунку живого гостя;
    //   - борг на виселенні рахується з фоліо, тож маркер відчинив би двері
    //     боржникові — той самий клас, що Р8.5.
    //
    // Доти тут стояла табличка «deposit → partial, full → paid», яка писала
    // слово, не знаючи СУМИ; потім (В3) — платіж у фоліо методом `transfer`
    // за гроші, яких ще немає. Тепер — жодного з двох.
    //
    // Третій стан платежу («заявлений/підтверджений») заводиться тоді, коли
    // його попросить готель, а не як побічний ефект маркера.
    const orgId = await requireOrganizationId();
    const res = await sql.row<{ id: string }>(
      'SELECT id FROM reservations WHERE id = ? AND organization_id = ?',
      [reservation_id, orgId],
    );
    if (!res) return NextResponse.json({ error: 'reservation not found' }, { status: 404 });

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
      // Слово оплати маркер не рухає за рішенням Ч8 — поле лишається, щоб
      // старий клієнт не читав `undefined`, і завжди `false`.
      statusChanged: false,
      message:
        'Позначка збережена. Реальна транзакція з\'явиться в Операціях, коли надійдуть гроші (банк / платформа).',
    }, { status: 201 });
  } catch (e: any) {
    return handleError('app/api/payments POST', e);
  }
});
