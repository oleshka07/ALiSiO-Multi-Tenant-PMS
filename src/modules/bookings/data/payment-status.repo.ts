/**
 * Статус оплати броні — ОДИН перерахунок, одна функція, один виклик (В3).
 *
 * Рішення власника 07.09: фоліо — єдина книга проживання. Скільки за бронь
 * заплачено, знає воно; `reservations.payment_status` — це слово, яке з нього
 * ВИВОДИТЬСЯ, а не друга книга поруч.
 *
 * До цього рахували троє, і кожен по-своєму:
 *   - `FolioPanel` після оплати ставив лише `paid` (частина не ставила нічого);
 *   - `finance/api/operations.handlers.ts` рахував із `fin_operations`;
 *   - `POST /api/payments` (маркерний шлях) писав слово прямо, без суми.
 * Наслідок був видимий: 3000 наперед із 5000 через фоліо давали борг 2000 на
 * виселенні, а ті самі 3000 через касу — 5000, бо гроші лежали поруч із
 * книгою, а не в ній.
 *
 * `is_prepaid` лишається винятком і тут: бронь, за яку канал уже зібрав гроші
 * з гостя, оплачена за означенням, і часткова банківська виплата не має права
 * повернути її в «не оплачено».
 */
import { getSql, type Sql } from '@core/db/async';
import { reservationFolioSummary } from '@invoicing/kernel';
import { statusFromFolio } from '../domain/folio-payment';

export interface PaymentStatusChange {
  /** Слово до перерахунку. */
  was: string;
  /** Слово після; те саме, коли фоліо не має що сказати. */
  now: string;
  changed: boolean;
}

/**
 * Перерахувати статус оплати броні З ФОЛІО і записати його.
 *
 * Фоліо, яке нічого не каже (немає нарахування проживання або грошей не
 * приходило), лишає слово як було: `null` від `statusFromFolio` — це «не мені
 * вирішувати», а не «не оплачено».
 */
export async function recalcPaymentStatusFromFolio(
  reservationId: string,
  t?: Sql,
): Promise<PaymentStatusChange | null> {
  const sql = t ?? getSql();
  const row = await sql.row<{ payment_status: string; is_prepaid: number | boolean | null }>(
    'SELECT payment_status, is_prepaid FROM reservations WHERE id = ?', [reservationId]);
  if (!row) return null;
  const was = String(row.payment_status ?? 'unpaid');
  // Передоплачена каналом бронь: платформа зібрала гроші з гостя, і банківська
  // виплата частинами не робить її «частково оплаченою» для рецепції.
  if (row.is_prepaid === 1 || row.is_prepaid === true) return { was, now: was, changed: false };

  const word = statusFromFolio(await reservationFolioSummary(reservationId, sql));
  if (!word || word === was) return { was, now: was, changed: false };

  await sql.run('UPDATE reservations SET payment_status = ? WHERE id = ?', [word, reservationId]);
  return { was, now: word, changed: true };
}
