/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { checkRateLimit } from '@core/security/rate-limit';
import { serverError } from '@core/http/errors';

/**
 * «Я хочу оплатити» — гість каже це готелю, бо заплатити сам не може.
 *
 * ── Що це замінює ────────────────────────────────────────────────────────
 *
 * Гостьова сторінка до оплати замкнена: вказівки, паркінг, код від дверей і
 * Wi-Fi відкриваються після оплати. А оплатити гість не може — онлайн-шлюзу в
 * продукті немає (`anyGatewayImplemented()` у core/payments.ts). Екран чесно
 * писав «оплату приймає готель, ось телефон», і на цьому все закінчувалось:
 * єдиний шлях далі — зателефонувати в робочий час, з чужої країни, чужою
 * мовою.
 *
 * Тепер є кнопка. Вона не бере грошей і не вдає, що бере: вона ставить броні
 * `payment_status = 'payment_requested'` — значення, яке в CHECK цієї колонки
 * стоїть із самого початку і яке оператор уже вміє показувати («Запит на
 * оплату», жовтий). Далі це підхоплює банер над списком броней
 * (`dashboard/domain/alerts.ts`, код `payment_requested`), і адміністратор
 * бачить, що конкретний гість чекає на рахунок.
 *
 * ── Чому саме статус, а не нова таблиця ──────────────────────────────────
 *
 * Спокуса була завести `payment_requests` з часом, коментарем і історією. Але
 * єдине питання, на яке ця дія відповідає, — «цей гість просив оплату?», і
 * колонка з таким значенням у схемі вже є. Нова таблиця дала б друге місце,
 * де живе стан оплати, і рано чи пізно вони розійшлись би — рівно так, як
 * розійшлися групи й sub-bookings.
 *
 * ── Межі ─────────────────────────────────────────────────────────────────
 *
 * Тенант приходить із токена посилання (`withGuest` у modules/guests/api),
 * тож писати можна тільки у СВОЮ бронь. Ідемпотентно: повторний натиск нічого
 * не змінює. Оплачену бронь не чіпає — інакше гість, який уже заплатив,
 * одним натиском повернув би її в «не оплачено» і зіпсував касу.
 */
export async function requestPayment(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  try {
    const { token } = await params;

    // Публічний маршрут: три натиски на пʼять хвилин. Стільки ж, скільки на
    // реєстрації гостя — та сама сторінка, та сама людина.
    const rl = await checkRateLimit(token, 'payment_request', 3, 5);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests. Please wait a few minutes.' }, { status: 429 });
    }

    const sql = getSql();

    // `payment_status IN ('unpaid')` навмисно вужче за «не paid»: 'prepaid' і
    // 'paid' — це гроші, які вже прийшли, а 'payment_requested' означає, що
    // запит уже стоїть і другий нічого не додасть.
    await sql.run(`
      UPDATE reservations
      SET payment_status = 'payment_requested', updated_at = CURRENT_TIMESTAMP
      WHERE guest_page_token = ? AND payment_status = 'unpaid'
    `, [token]);

    // Відповідь однакова і на перший натиск, і на десятий, і на бронь, яка вже
    // оплачена. Гостю нема чого знати, у якому стані каса готелю; йому треба
    // знати, що готель почув.
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return serverError('modules/guests/api/payment-request requestPayment', error);
  }
}
