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
export const FREES_THE_ROOM = "('cancelled', 'no_show')";

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

export type StayOverlapInput = {
  unitId: string;
  checkIn: string;
  checkOut: string;
  /** Бронь, яку переносимо — сама собі не заважає. */
  excludeReservationId?: string | null;
};

/**
 * Хто вже стоїть у цьому номері на ці ночі — id живої броні або `null`.
 *
 * Окрема функція, бо цей самий запит потрібен ДВІЧІ й у різних ролях: тут, як
 * людська перевірка перед записом, і в `@bookings/api/overlap` як те, що на
 * SQLite тримає замість обмеження бази (INC-045). Дві копії запиту розійшлись
 * би так само, як розійшлися б два списки статусів, — і тоді SQLite почав би
 * пускати те, що Postgres забороняє, при зелених гейтах.
 *
 * Півінтервал і `is_pool` — ті самі, що в обмеженні `no_double_booking`.
 */
export async function stayOverlapsExisting(
  sql: Sql, input: StayOverlapInput,
): Promise<string | null> {
  if (await isPoolUnit(sql, input.unitId)) return null;
  return bookingOverlap(sql, input);
}

/** Сам запит про перетин, уже без питання про службовий фонд. */
async function bookingOverlap(sql: Sql, input: StayOverlapInput): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const booking = await sql.row<any>(
    `SELECT id FROM reservations
      WHERE unit_id = ? AND id <> ? AND status NOT IN ${FREES_THE_ROOM}
        AND check_in < ? AND check_out > ?
      LIMIT 1`,
    [input.unitId, input.excludeReservationId ?? '', input.checkOut, input.checkIn]);
  return booking ? String(booking.id) : null;
}

/**
 * Службовий фонд тримає багато броней навмисно — конфлікту там немає.
 *
 * Своя функція, а не два однакові `SELECT is_pool`: другий такий запит у цьому
 * файлі був НОВИМ порушенням храповика осі обʼєкта, і правильно — читання за
 * `id` без орендаря варте одного місця, а не двох.
 */
async function isPoolUnit(sql: Sql, unitId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unit = await sql.row<any>('SELECT is_pool FROM units WHERE id = ?', [unitId]);
  return Boolean(unit?.is_pool);
}

export async function findStayConflict(sql: Sql, input: StayOverlapInput): Promise<StayConflict> {
  // Басейн не конфліктує ні з бронню, ні з закриттям: вихід ДО обох запитів,
  // як було до появи `stayOverlapsExisting`.
  if (await isPoolUnit(sql, input.unitId)) return null;

  // `bookingOverlap`, не `stayOverlapsExisting`: та спитала б про службовий
  // фонд удруге — зайвий похід у базу на кожну перевірку перед записом.
  const booking = await bookingOverlap(sql, input);
  if (booking) return { kind: 'booking', id: booking };

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
