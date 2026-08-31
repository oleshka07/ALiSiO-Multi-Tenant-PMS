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
 *
 * ТРЕТЄ ДЖЕРЕЛО: БРОНЬ БЕЗ ПРИЗНАЧЕНОГО НОМЕРА
 *
 * З CP3 бронь може мати `unit_type_id` і `unit_id = NULL`: Channex про
 * `units` не знає нічого, він адресує ТИП номера, тож OTA-бронь приходить
 * без кімнати, і рецепція призначає її потім.
 *
 * Така бронь не займає ЖОДНОГО конкретного номера — і саме тому обидва
 * запити вище її не бачать. Але вона займає **один номер цього типу**, і
 * якщо цього не відняти, готель продасть ту саму кімнату вдруге. Причому
 * саме через канал: віджет покаже тип вільним, бо жоден номер не зайнятий.
 *
 * Тому зайнятість тут має два виміри, а не один:
 *
 *   поіменна   `occupiedSpans()` — цей номер не продається в ці ночі;
 *   ємнісна    `unassignedByTypeDay()` — з цього типу вже продано N кімнат,
 *              хоч і не сказано яких.
 *
 * Перше відповідає на «чи вільний номер 101», друге — на «чи можу я продати
 * ще один двомісний». Обидві функції нижче зводять їх разом, бо жоден
 * споживач не питає лише одне з двох: і віджет, і батчер ARI питають «що я
 * можу продати».
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
 * Скільки броней БЕЗ призначеного номера тисне на кожен тип у кожну ніч.
 *
 * Бронь без `unit_id` не робить жоден конкретний номер зайнятим, тож
 * `occupiedSpans()` її не бачить — і не має бачити. Вона з'їдає ЄМНІСТЬ
 * типу, і відняти це можна лише тут.
 *
 * `unit_type_id IS NOT NULL` обов'язково: бронь без обох ідентифікаторів —
 * це зіпсований рядок, а не бронь типу. Відняти її від якогось типу було б
 * вгадуванням, і воно б зменшило наявність там, де для цього немає підстав.
 *
 * Проміжок обрізається вікном запиту тим самим півінтервалом, що й скрізь
 * тут: ніч належить даті заїзду.
 */
async function unassignedByTypeDay(
  propertyIds: string[],
  from: DateStr,
  to: DateStr,
): Promise<Map<UnitTypeId, Map<DateStr, number>>> {
  const sql = getSql();
  const result = new Map<UnitTypeId, Map<DateStr, number>>();
  if (propertyIds.length === 0) return result;

  const ph = propertyIds.map(() => '?').join(', ');
  const rows = (await sql.rows<{ unit_type_id: UnitTypeId; check_in: string; check_out: string }>(
    `SELECT r.unit_type_id, r.check_in, r.check_out
       FROM reservations r
      WHERE r.property_id IN (${ph})
        AND r.unit_id IS NULL
        AND r.unit_type_id IS NOT NULL
        AND r.status NOT IN ('cancelled', 'no_show')
        AND r.check_in < ? AND r.check_out > ?`,
    [...propertyIds, to, from],
  )) as { unit_type_id: UnitTypeId; check_in: string; check_out: string }[];

  for (const r of rows) {
    let perDay = result.get(r.unit_type_id);
    if (!perDay) result.set(r.unit_type_id, (perDay = new Map()));
    const start = dayOf(r.check_in) > from ? dayOf(r.check_in) : from;
    const end = dayOf(r.check_out) < to ? dayOf(r.check_out) : to;
    for (let d = start; d < end; d = shiftDays(d, 1)) {
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
  }

  return result;
}

/**
 * Скільки кімнат на добу вже продано БЕЗ призначеного номера.
 *
 * Публічна форма того самого розрахунку — для тих, хто рахує наявність не
 * по мапі типів, а одним числом на день. Такий споживач один: публічний
 * календар віджета, який показує «вільно / частково / зайнято» на весь
 * обʼєкт або на зріз фонду сайту.
 *
 * Віддається саме тиск, а не готова наявність, бо політику «які номери
 * взагалі рахуються» той календар має свою (три режими: один номер, фонд
 * сайту, весь обʼєкт), і підмінити її тут означало б змінити його відповідь.
 * Спільним лишається те, що й має бути спільним: що таке бронь без номера.
 *
 * `unitTypeIds` порожній або не переданий — усі типи обʼєкта.
 */
export async function unassignedPressureByDay(
  propertyId: string,
  from: DateStr,
  to: DateStr,
  unitTypeIds?: UnitTypeId[],
): Promise<Map<DateStr, number>> {
  const byType = await unassignedByTypeDay([propertyId], from, to);
  const wanted = unitTypeIds && unitTypeIds.length > 0 ? new Set(unitTypeIds) : null;
  const total = new Map<DateStr, number>();
  for (const [typeId, perDay] of byType) {
    if (wanted && !wanted.has(typeId)) continue;
    for (const [date, n] of perDay) total.set(date, (total.get(date) ?? 0) + n);
  }
  return total;
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

  const sql = getSql();
  const taken = new Set((await occupiedSpans(unitIds, from, to)).map(s => s.unitId));
  const free = unitIds.filter(id => !taken.has(id));
  if (free.length === 0) return new Set();

  // ── Ємнісний тиск броней без номера ────────────────────────────────────
  //
  // Номери вище справді вільні поіменно. Але якщо з цього типу вже продано
  // дві кімнати «якісь», то дві з них продати вже не можна — і відняти це
  // треба ТУТ, а не в тому, хто питає: інакше це другий розрахунок
  // наявності, тобто рівно те, від чого існує інваріант И3.
  //
  // Тип і обʼєкт беруться з бази, а не від виклику: споживач передає лише
  // список номерів, і вимагати від нього ще й типів означало б, що він мусить
  // знати, як улаштована відповідь.
  const meta = (await sql.rows<{ id: UnitId; unit_type_id: UnitTypeId; property_id: string }>(
    `SELECT id, unit_type_id, property_id FROM units WHERE id IN (${free.map(() => '?').join(', ')})`,
    free,
  )) as { id: UnitId; unit_type_id: UnitTypeId; property_id: string }[];

  const properties = [...new Set(meta.map(m => m.property_id))];
  const pressure = await unassignedByTypeDay(properties, from, to);
  if (pressure.size === 0) return new Set(free);

  const result = new Set(free);
  const byType = new Map<UnitTypeId, UnitId[]>();
  for (const m of meta) {
    const list = byType.get(m.unit_type_id);
    if (list) list.push(m.id); else byType.set(m.unit_type_id, [m.id]);
  }

  for (const [typeId, ids] of byType) {
    const perDay = pressure.get(typeId);
    if (!perDay) continue;
    // Питання — «вільний на ВЕСЬ заїзд», тож обмежує найгірша ніч. Тиск у
    // дві кімнати на одну ніч із трьох робить недоступними дві кімнати на
    // весь діапазон: гість не може заїхати в номер, який зайнятий у середу.
    const worst = Math.max(0, ...perDay.values());
    // Детерміновано за id: яку саме кімнату «зʼїла» безномерна бронь, не
    // визначено за побудовою — важлива лише кількість. Але однаковий вибір
    // на однакових даних робить поведінку відтворюваною й перевірною.
    for (const id of [...ids].sort().slice(0, worst)) result.delete(id);
  }

  return result;
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

  // Скільки з кожного типу вже продано без призначеної кімнати. Ці броні не
  // роблять жоден номер зайнятим, тож цикл нижче їх не побачив би — і канал
  // отримав би на одиницю більше, ніж готель може віддати.
  const pressure = await unassignedByTypeDay([propertyId], from, to);

  for (const [typeId, unitIds] of byType) {
    const perDay = new Map<DateStr, number>();
    const typePressure = pressure.get(typeId);
    for (const date of dates) {
      let free = 0;
      for (const unitId of unitIds) if (!occupied.get(unitId)?.has(date)) free++;
      // Нуль знизу: тиск більший за фонд означає овербукінг, який УЖЕ
      // стався. Відʼємне число в каналі — це помилка протоколу поверх
      // помилки готелю; нуль каже правду («більше не продавайте») і лишає
      // проблему видимою там, де її видно — у списку броней.
      perDay.set(date, Math.max(0, free - (typePressure?.get(date) ?? 0)));
    }
    result.set(typeId, perDay);
  }

  return result;
}
