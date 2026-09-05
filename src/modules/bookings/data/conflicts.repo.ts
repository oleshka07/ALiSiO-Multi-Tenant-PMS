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
      WHERE unit_id = ? AND id <> ? AND status NOT IN ('cancelled', 'no_show')
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
