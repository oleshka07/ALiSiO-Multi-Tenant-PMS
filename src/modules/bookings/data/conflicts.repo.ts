/**
 * Що заважає броні стати в номер на ці дати: інша бронь або закриття номера
 * (Блок 4 §2.4).
 *
 * До цього PATCH броні дивився лише на інші броні: перенести гостя в номер,
 * закритий на ремонт (`availability_blocks`), сервер дозволяв — планер
 * малював гостя поверх «🔒 Закрито», і покоївка з малярем зʼясовували це на
 * місці. Тепер обидва джерела питаються одним місцем, і форма перенесення,
 * перетягування в планері та розселення відповідають однаково: 409 з
 * назвою причини.
 *
 * Півінтервал [заїзд, виїзд): виїзд 12-го і заїзд 12-го не конфліктують.
 * Скасовані й no-show номер звільняють. Басейн (`is_pool`) тримає багато
 * броней навмисно — там конфлікту немає за означенням.
 */
import type { Sql } from '@core/db/async';

/**
 * Статуси, за яких бронь кімнату НЕ тримає. Один список на обидва питання
 * цього файла — «чи можна сюди стати» і «хто вже стоїть удвох»: два списки
 * розійшлись би при першому ж новому статусі, і одна відповідь почала б
 * суперечити другій, нічого не зламавши.
 */
const FREES_THE_ROOM = "('cancelled', 'no_show')";

/**
 * Броні, які ділять кімнату з іншою живою бронню хоч на одну ніч —
 * овербукінг, який УЖЕ стався (Блок 4 §2.5, фільтр «показати конфліктні»).
 *
 * Фрагмент `WHERE`, а не функція: список броней будується одним великим
 * запитом зі своїми джойнами, і другий запит по id дав би інший зріз між
 * ними. Підставляється дослівно, підзапити самодостатні від `r`.
 *
 * Півінтервал і статуси — ті самі, що у `findStayConflict` нижче.
 * Службовий фонд (`is_pool`) тримає багато броней навмисно; бронь без
 * кімнати поіменно не конфліктує ні з ким (її тиск на ємність — питання до
 * `@properties`).
 */
export const CONFLICTING_SQL = `
  r.unit_id IS NOT NULL
  AND r.status NOT IN ${FREES_THE_ROOM}
  AND NOT EXISTS (SELECT 1 FROM units pu WHERE pu.id = r.unit_id AND pu.is_pool = TRUE)
  AND EXISTS (
    SELECT 1 FROM reservations o
     WHERE o.unit_id = r.unit_id AND o.id <> r.id
       AND o.status NOT IN ${FREES_THE_ROOM}
       AND o.check_in < r.check_out AND o.check_out > r.check_in
  )`;

export type StayConflict =
  | { kind: 'booking'; id: string }
  | { kind: 'block'; id: string; reason: string | null; date_from: string; date_to: string }
  | null;

export async function findStayConflict(sql: Sql, input: {
  unitId: string;
  checkIn: string;
  checkOut: string;
  /** Бронь, яку переносимо — сама собі не заважає. */
  excludeReservationId?: string | null;
}): Promise<StayConflict> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unit = await sql.row<any>('SELECT is_pool FROM units WHERE id = ?', [input.unitId]);
  if (unit?.is_pool) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const booking = await sql.row<any>(
    `SELECT id FROM reservations
      WHERE unit_id = ? AND id <> ? AND status NOT IN ${FREES_THE_ROOM}
        AND check_in < ? AND check_out > ?
      LIMIT 1`,
    [input.unitId, input.excludeReservationId ?? '', input.checkOut, input.checkIn]);
  if (booking) return { kind: 'booking', id: String(booking.id) };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const block = await sql.row<any>(
    `SELECT id, reason, date_from, date_to FROM availability_blocks
      WHERE unit_id = ? AND date_from < ? AND date_to > ?
      LIMIT 1`,
    [input.unitId, input.checkOut, input.checkIn]);
  if (block) {
    return {
      kind: 'block', id: String(block.id), reason: block.reason ? String(block.reason) : null,
      date_from: String(block.date_from).slice(0, 10), date_to: String(block.date_to).slice(0, 10),
    };
  }
  return null;
}
