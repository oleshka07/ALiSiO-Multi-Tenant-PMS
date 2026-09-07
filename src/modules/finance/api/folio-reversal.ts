/**
 * Гроші, зняті з фінансової книги, знімаються і з книги гостя (Р8.7).
 *
 * Фоліо — єдина книга проживання (В3), але каса пише в обидві: рядок
 * `fin_operations` і платіж у фоліо. Видалення чистило лише першу, і «видалено»
 * переставало означати «повернено»:
 *
 *   рецепція видаляє помилковий платіж → рядок `fin_operations` зник →
 *   спільний перерахунок читає ФОЛІО, бачить там ті самі гроші → бронь
 *   лишається `paid`, виселення відчинене, а грошей уже ніде немає.
 *
 * Помилки не буває ніде: обидві книги «працюють», просто кажуть різне.
 *
 * Файл навмисно ЛИСТКОВИЙ — лише двері фасадів, жодного імпорту з
 * `operations.handlers` чи `payment-bridge`. Обидва кличуть його, і якби
 * правило жило в одному з них, другий отримав би цикл імпортів; а копія
 * правила у двох місцях — це рівно те, з чого почався В3.
 *
 * Тримає `scripts/check-payment-delete.mjs --strict`.
 */
import { reverseReservationPayment } from '@invoicing/kernel';
import { recalcPaymentStatusFromFolio } from '@bookings/kernel';

/** Те, що треба знати про видалену операцію, і нічого більше. */
export interface DeletedOperation {
  reservation_id?: string | null;
  amount?: number | string | null;
  op_type?: string | null;
}

/**
 * Зняти з книги гостя гроші видаленої операції і перерахувати слово броні.
 *
 * Кличеться ПІСЛЯ видалення рядка: зустрічний рядок у фоліо обмежений тим, що
 * книга справді тримає (`reverseReservationPayment`), тож повторний виклик не
 * знімає вдруге.
 *
 * Операція без броні (звичайна витрата у Фінансах) не має книги гостя — тиха
 * відповідь тут правильна, це не пропущений випадок.
 *
 * Свідомо не зроблено: видалення ПОВЕРНЕННЯ (`op_type = 'expense'`) не
 * повертає гроші у фоліо назад. Зустрічний рядок уміє лише зменшувати
 * сплачене, а додати позитивний платіж «бо колись було повернення» означало б
 * вигадати гроші, яких у книзі може вже не бути. Слово броні при цьому
 * перераховується — фоліо лишається джерелом, і розбіжність видно; сам
 * симетричний випадок названо у звіті.
 */
export async function reverseOperationInFolio(op: DeletedOperation | null | undefined): Promise<void> {
  const reservationId = op?.reservation_id;
  if (!reservationId) return;
  if (op?.op_type === 'income') {
    await reverseReservationPayment({
      reservationId: String(reservationId),
      amount: Math.abs(Number(op?.amount) || 0),
    }).catch((e: unknown) => {
      // Книга гостя могла відмовити законно (німецький обʼєкт без `fiscal_de`
      // не тримає там готівки взагалі). Мовчати не можна — інваріант 13, — але
      // й валити видалення вже видаленого рядка теж.
      console.warn(`[folio-reversal] фоліо не прийняло зустрічний рядок за ${String(reservationId)}: ${(e as Error)?.message}`);
    });
  }
  await recalcPaymentStatusFromFolio(String(reservationId));
}

/**
 * Те саме для всіх операцій однієї броні одразу (чистка iCal-броні).
 *
 * Сума береться з рядків ДО видалення: після нього питати вже нічого.
 */
export async function reverseOperationsInFolio(
  reservationId: string,
  incomeTotal: number,
): Promise<void> {
  await reverseOperationInFolio({ reservation_id: reservationId, amount: incomeTotal, op_type: 'income' });
}
