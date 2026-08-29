/**
 * Скільки номерів вільно — одна відповідь для всіх, хто питає.
 *
 * Розрахунок жив усередині обробника віджета: два запити на КОЖЕН номер у
 * циклі («чи є бронь», «чи є блокування»). Поки споживач був один, це
 * працювало. Другий споживач — батчер ARI, який шле наявність у канали, — не
 * може мати власну копію цієї логіки: два розрахунки наявності дають два
 * різні числа на одну дату, і готель дізнається про це від гостя, який
 * приїхав у зайнятий номер. Овербукінг через OTA коштує грошей і рейтингу,
 * а виникає з одного зайвого `JOIN`, написаного в іншому файлі.
 *
 * Це той самий прийом, що й `priceNights()` для цін (інваріант 16): одне
 * джерело відповіді, решта до нього звертається.
 *
 * ЩО САМЕ СПІЛЬНЕ, А ЩО НІ
 *
 * Спільна тут **зайнятість**: які ночі номер уже не продається. Саме вона
 * розходиться непомітно і саме вона дає овербукінг.
 *
 * НЕ спільний тут добір номерів. Віджет показує те, що виставлено на його
 * сайті; канал може отримувати інший зріз фонду (docs/CHANNEX-INTEGRATION.md
 * §10.8). Тому `freeUnitsForRange()` приймає список номерів від того, хто
 * питає, і нічого до нього не додає — а політику «що взагалі продається»
 * тримає `availabilityByDay()`, у якої споживач один.
 *
 * ПІВІНТЕРВАЛ [from, to)
 *
 * Ніч належить даті заїзду. Бронь 10→12 займає ночі 10 і 11, а 12-те вже
 * вільне: у ніч виїзду номер продається. Тому перетин — це
 * `check_in < to AND check_out > from`, а не `<=`. Той самий півінтервал і
 * в `availability_blocks`.
 *
 * ДВА ДЖЕРЕЛА ЗАЙНЯТОСТІ
 *
 * `reservations` (крім скасованих і неявок) і `availability_blocks` —
 * ремонт, службове закриття, блок із зовнішнього календаря. Обидва однаково
 * роблять номер непродаваним; різниця лише в тому, хто їх створив.
 *
 * `availability_blocks` створюється міграцією, а не базовою схемою, тому
 * перед запитом перевіряється наявність таблиці — так само, як це робив
 * віджет.
 */
import { getSql } from '@core/db/async';
import { shiftDays, daysBetween } from '@core/hotel-day';

/** Календарна дата, `YYYY-MM-DD`. */
export type DateStr = string;
export type UnitId = string;
export type UnitTypeId = string;

/** Проміжок, на який номер зайнятий. Півінтервал, як і скрізь тут. */
export interface OccupiedSpan {
  unitId: UnitId;
  from: DateStr;
  to: DateStr;
}

async function hasAvailabilityBlocks(): Promise<boolean> {
  const sql = getSql();
  const tables = (await sql.rows<{ name: string }>(sql.dialect.tables())) as { name: string }[];
  return tables.some(t => t.name === 'availability_blocks');
}

/**
 * Дата з колонки, яка може містити час.
 *
 * `check_in`/`date_from` подекуди зберігаються як `YYYY-MM-DD HH:MM:SS`, і
 * порівняння рядків із чистою датою тоді зсувається на добу.
 */
function dayOf(value: string): DateStr {
  return String(value).slice(0, 10);
}

/**
 * Усе, що робить перелічені номери непродаваними в `[from, to)`.
 *
 * Єдине місце, яке знає, з чого складається зайнятість. Обидві публічні
 * функції нижче — це вже тільки різні способи згорнути цей список.
 */
async function occupiedSpans(unitIds: UnitId[], from: DateStr, to: DateStr): Promise<OccupiedSpan[]> {
  const sql = getSql();
  if (unitIds.length === 0) return [];

  const placeholders = unitIds.map(() => '?').join(', ');
  const spans: OccupiedSpan[] = [];

  const stays = (await sql.rows<{ unit_id: UnitId; check_in: string; check_out: string }>(
    `SELECT r.unit_id, r.check_in, r.check_out
       FROM reservations r
      WHERE r.unit_id IN (${placeholders})
        AND r.status NOT IN ('cancelled', 'no_show')
        AND r.check_in < ? AND r.check_out > ?`,
    [...unitIds, to, from],
  )) as { unit_id: UnitId; check_in: string; check_out: string }[];

  for (const s of stays) {
    spans.push({ unitId: s.unit_id, from: dayOf(s.check_in), to: dayOf(s.check_out) });
  }

  if (await hasAvailabilityBlocks()) {
    const blocks = (await sql.rows<{ unit_id: UnitId; date_from: string; date_to: string }>(
      `SELECT unit_id, date_from, date_to
         FROM availability_blocks
        WHERE unit_id IN (${placeholders})
          AND date_from < ? AND date_to > ?`,
      [...unitIds, to, from],
    )) as { unit_id: UnitId; date_from: string; date_to: string }[];
    for (const b of blocks) {
      spans.push({ unitId: b.unit_id, from: dayOf(b.date_from), to: dayOf(b.date_to) });
    }
  }

  return spans;
}

/**
 * З переданих номерів — ті, що вільні на КОЖНУ ніч діапазону `[from, to)`.
 *
 * Саме те, що питає віджет: гість шукає на весь заїзд, і номер, вільний
 * лише частину ночей, йому не підходить. Один запит на весь список замість
 * двох запитів на кожен номер.
 *
 * Порожній або зворотний діапазон означає «дат не питали»: повертаються всі
 * передані номери, бо жодна ніч не могла бути зайнята.
 */
export async function freeUnitsForRange(
  unitIds: UnitId[],
  from: DateStr,
  to: DateStr,
): Promise<Set<UnitId>> {
  if (unitIds.length === 0) return new Set();
  if (daysBetween(from, to) <= 0) return new Set(unitIds);

  const taken = new Set((await occupiedSpans(unitIds, from, to)).map(s => s.unitId));
  return new Set(unitIds.filter(id => !taken.has(id)));
}

/**
 * Скільки номерів кожного типу вільно на кожну ніч діапазону `[from, to)`.
 *
 * Це форма, якої чекає ARI: Channex приймає наявність як
 * `room_type_id → дата → ціле невід'ємне число`
 * (docs/CHANNEX-INTEGRATION.md §5), і саме її батчер стискає в діапазони.
 *
 * Тип номера з нулем вільних лишається у відповіді з нулями, а не зникає:
 * канал мусить почути «нуль», інакше він і далі продаватиме за останнім
 * числом, яке чув.
 *
 * Порожній або зворотний діапазон дає порожню мапу: нуль ночей — це не
 * «нуль вільно», це відсутність питання.
 */
export async function availabilityByDay(
  propertyId: string,
  from: DateStr,
  to: DateStr,
): Promise<Map<UnitTypeId, Map<DateStr, number>>> {
  const sql = getSql();
  const result = new Map<UnitTypeId, Map<DateStr, number>>();

  const nights = daysBetween(from, to);
  if (nights <= 0) return result;

  const units = (await sql.rows<{ id: UnitId; unit_type_id: UnitTypeId }>(
    `SELECT u.id, u.unit_type_id
       FROM units u
       JOIN unit_types ut ON ut.id = u.unit_type_id
      WHERE u.property_id = ?
        AND u.is_active = TRUE
        AND u.room_status = 'available'
        -- Віртуальний номер-накопичувач модалки розселення: фізично не
        -- існує, продати його не можна.
        AND u.is_pool = FALSE
        -- Номер, який продає рецепція, а сайт і канали — ні.
        AND ut.bookable_online = TRUE`,
    [propertyId],
  )) as { id: UnitId; unit_type_id: UnitTypeId }[];

  if (units.length === 0) return result;

  const dates: DateStr[] = [];
  for (let i = 0, d = from; i < nights; i++, d = shiftDays(d, 1)) dates.push(d);

  const byType = new Map<UnitTypeId, UnitId[]>();
  for (const u of units) {
    const list = byType.get(u.unit_type_id);
    if (list) list.push(u.id);
    else byType.set(u.unit_type_id, [u.id]);
  }

  const occupied = new Map<UnitId, Set<DateStr>>();
  for (const span of await occupiedSpans(units.map(u => u.id), from, to)) {
    let nightsSet = occupied.get(span.unitId);
    if (!nightsSet) occupied.set(span.unitId, (nightsSet = new Set()));
    // Обрізаємо проміжок вікном запиту: бронь може починатись до `from` і
    // тягнутись за `to`.
    const start = span.from > from ? span.from : from;
    const end = span.to < to ? span.to : to;
    for (let d = start; d < end; d = shiftDays(d, 1)) nightsSet.add(d);
  }

  for (const [typeId, unitIds] of byType) {
    const perDay = new Map<DateStr, number>();
    for (const date of dates) {
      let free = 0;
      for (const unitId of unitIds) if (!occupied.get(unitId)?.has(date)) free++;
      perDay.set(date, free);
    }
    result.set(typeId, perDay);
  }

  return result;
}
