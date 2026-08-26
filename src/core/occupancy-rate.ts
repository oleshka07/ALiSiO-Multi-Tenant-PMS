import { dayString, daysBetween, shiftDays } from './hotel-day.ts';

/**
 * Завантаженість: скільки номерів готелю зайнято з тих, які взагалі продаються.
 *
 * Формул було дві, під одним підписом «Завантаженість», і власник бачив за той
 * самий день різні числа (AUDIT.md §2.9):
 *
 *   dashboard.handlers.ts  знаменник — активні non-pool юніти,
 *                          чисельник  — статуси checked_in + confirmed;
 *   reports.handlers.ts    знаменник — УСІ юніти,
 *                          чисельник  — усі статуси, крім cancelled і draft.
 *
 * Розходились обидві половини дробу, тож числа не просто відрізнялись — вони
 * відрізнялись у різні боки, і жодне не було правдою. Звіт брав у знаменник
 * номери, знятих з продажу, і pool-юніт («Чорновик» — віртуальний юніт, куди
 * складають нерозселені броні): готель на 10 номерів мав знаменник 12 і
 * назавжди недосяжні 100 %. Дашборд не рахував `tentative` — броню, яка тримає
 * номер і не дає його продати, — і показував вільним те, що зайняте.
 *
 * Тут одна формула на обидва місця, і вона працює над РЯДКАМИ, а не над
 * готовими сумами: якби модуль приймав уже порахований чисельник і знаменник,
 * два хендлери й далі могли б порахувати їх по-різному — тобто саме та вада,
 * що описана в §2.9, лишилася б можливою. Правила «що продається» і «що
 * зайняте» мусять жити в одному місці разом з арифметикою.
 *
 * Бази тут немає навмисно: усе, що нижче, перевіряється гейтом
 * `occupancy-rate.check.ts` без сервера й без схеми.
 */

/**
 * Статуси, за яких номер вважається зайнятим.
 *
 * Це той самий набір, який у `bookings/data/day-sheets.repo.ts` називається
 * LIVE, і це не збіг: «номер зайнятий» і «на цю добу є кого селити» — одне
 * питання, і дві відповіді на нього вже коштували цього аудиту.
 *
 *   confirmed    броня підтверджена, номер знято з продажу;
 *   tentative    те саме — усі перевірки доступності в проєкті відкидають лише
 *                cancelled/no_show, отже tentative так само блокує номер;
 *                показати його вільним означає продати номер двічі;
 *   checked_in   гість у номері;
 *   checked_out  гість виїхав, але доба, яку він прожив, була зайнята — без
 *                цього статусу звіт за минулий місяць показав би майже нуль,
 *                бо в минулому майже всі броні вже checked_out.
 *
 * Свідомо НЕ входять:
 *
 *   cancelled    номер повернувся в продаж;
 *   no_show      гість не приїхав, ліжко стояло порожнім, і о 00:30
 *                `dashboard/api/alerts.handlers.ts` сам переводить сюди
 *                прострочені confirmed. Рахувати no_show зайнятим означало б,
 *                що номер, з якого ніхто не ночував, назавжди лишається
 *                «зайнятим» у статистиці;
 *   draft        ще не броня. Живе на pool-юніті, який і так поза продажем.
 */
export const OCCUPYING_STATUSES: readonly string[] = [
  'confirmed', 'tentative', 'checked_in', 'checked_out',
];

/** Чи тримає ця броня номер у цю добу (за статусом, без дат). */
export function occupiesUnit(status: unknown): boolean {
  return typeof status === 'string' && OCCUPYING_STATUSES.includes(status);
}

/**
 * Прапорець із двох драйверів: SQLite віддає 1/0, Postgres — true/false.
 * Читати `Boolean(v)` наосліп не можна: рядок '0' з нього виходить істиною.
 */
function flag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return !['', '0', 'f', 'false', 'FALSE'].includes(value);
  return false;
}

export interface UnitRow {
  id?: unknown;
  is_active?: unknown;
  is_pool?: unknown;
}

export interface StayRow {
  unit_id?: unknown;
  check_in?: unknown;
  check_out?: unknown;
  status?: unknown;
}

/**
 * Чи входить юніт у знаменник — тобто чи це номер, який готель продає.
 *
 *   is_pool     віртуальний юніт «Чорновик»: кімнати за ним немає. У
 *               знаменнику він занижує завантаженість назавжди, у чисельнику —
 *               дає понад 100 %, бо нерозселена броня порахувалася б удруге;
 *   is_active   номер, знятий з продажу (ремонт, поза експлуатацією). Готель
 *               не може його продати, отже це не втрачена продажа, а
 *               відсутній товар.
 *
 * Відсутнє (`undefined`/`null`) значення `is_active` читається як «активний».
 * Протилежний дефолт небезпечніший: він вимів би весь номерний фонд у
 * знаменнику, і замість помилки власник побачив би рівні 0 % — число, схоже на
 * правду в мертвий сезон.
 */
export function isSellableUnit(unit: UnitRow): boolean {
  const active = unit.is_active === undefined || unit.is_active === null ? true : flag(unit.is_active);
  return active && !flag(unit.is_pool);
}

export interface Occupancy {
  /** Скільки номерів готель узагалі продає. */
  sellableUnits: number;
  /** Діб у періоді, включно з обома кінцями. */
  days: number;
  /** Знаменник: номеро-доби, які були в продажу. */
  unitDays: number;
  /** Чисельник: номеро-доби, які були зайняті. */
  occupiedUnitDays: number;
  /** Відсоток, ціле число 0..100. */
  rate: number;
}

/**
 * Завантаженість за період [from; to] включно.
 *
 * `units` і `stays` — сирі рядки з бази; фільтрувати їх у SQL не треба й не
 * можна: щойно один хендлер відфільтрує їх інакше за інший, повернеться §2.9.
 * Запит обмежує лише ВІКНО (`check_out > from AND check_in <= to`) — це не
 * частина формули, а спосіб не тягнути в памʼять усю історію готелю.
 */
export function occupancy(units: readonly UnitRow[], stays: readonly StayRow[], from: string, to: string): Occupancy {
  const sellable = new Set<string>();
  for (const u of units) {
    if (typeof u.id === 'string' && isSellableUnit(u)) sellable.add(u.id);
  }

  // Період, вивернутий навиворіт, — це помилка вводу, а не привід ділити на
  // нуль: беремо одну добу `from` і показуємо число, а не порожній екран.
  const days = Math.max(1, daysBetween(from, to) + 1);

  // Броня тримає номер від дати заїзду включно до дати виїзду ВИКЛЮЧНО: у добу
  // виїзду номер уже продається наступному гостю.
  const held: Array<{ unit: string; in: string; out: string }> = [];
  for (const s of stays) {
    if (!occupiesUnit(s.status)) continue;
    if (typeof s.unit_id !== 'string' || !sellable.has(s.unit_id)) continue;
    const ci = dayString(s.check_in);
    const co = dayString(s.check_out);
    if (!ci || !co) continue;
    held.push({ unit: s.unit_id, in: ci, out: co });
  }

  let occupiedUnitDays = 0;
  let day = from;
  for (let i = 0; i < days; i++) {
    const busy = new Set<string>();
    for (const h of held) {
      if (day >= h.in && day < h.out) busy.add(h.unit);
    }
    occupiedUnitDays += busy.size;
    day = shiftDays(day, 1);
  }

  const unitDays = sellable.size * days;
  return {
    sellableUnits: sellable.size,
    days,
    unitDays,
    occupiedUnitDays,
    // Готель без жодного номера в продажу — це 0 %, а не NaN. NaN їде в JSON
    // як null, і плитка на дашборді просто зникає замість того, щоб сказати,
    // що продавати нема чого.
    rate: unitDays > 0 ? Math.round((occupiedUnitDays / unitDays) * 100) : 0,
  };
}

export interface DayOccupancy extends Occupancy {
  /** Зайнятих номерів у цю добу. */
  occupiedUnits: number;
  /** Вільних номерів у цю добу. */
  freeUnits: number;
}

/** Та сама формула на одну добу — те, що показує дашборд. */
export function occupancyOnDay(units: readonly UnitRow[], stays: readonly StayRow[], day: string): DayOccupancy {
  const o = occupancy(units, stays, day, day);
  return { ...o, occupiedUnits: o.occupiedUnitDays, freeUnits: o.sellableUnits - o.occupiedUnitDays };
}
