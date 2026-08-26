/**
 * Завантаженість рахується одна.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/core/occupancy-rate.check.ts
 *
 * AUDIT.md §2.9: дашборд і звіт рахували «Завантаженість» двома різними
 * формулами під одним підписом. Розходились обидві половини дробу — знаменник
 * (звіт брав усі юніти, дашборд лише активні non-pool) і чисельник (звіт брав
 * усе, крім cancelled/draft, дашборд лише checked_in/confirmed). Власник бачив
 * за один день два числа й не мав способу зрозуміти, яке з них правда.
 *
 * Головне твердження цього гейта — останнє: завантаженість за одну добу,
 * порахована «як дашборд», дорівнює завантаженості за період з однієї доби,
 * порахованій «як звіт». Решта фіксує, чому саме така формула.
 */
import assert from 'node:assert';
import { occupancy, occupancyOnDay, occupiesUnit, isSellableUnit, OCCUPYING_STATUSES } from './occupancy-rate.ts';

/** Готель на 10 номерів. */
const TEN = Array.from({ length: 10 }, (_, i) => ({ id: `u${i + 1}`, is_active: 1, is_pool: 0 }));

/** Броня на одну ніч у номері `unit`. */
const stay = (unit: string, checkIn: string, checkOut: string, status = 'confirmed') =>
  ({ unit_id: unit, check_in: checkIn, check_out: checkOut, status });

const DAY = '2026-06-16';

// ── Нуль юнітів: ділення на нуль ────────────────────────────────────────────
//
// Порожній номерний фонд — це новий готель, який ще не завів кімнати, або
// готель, у якого всі номери на ремонті. NaN звідси їде в JSON як null, і
// плитка на дашборді зникає замість того, щоб показати нуль.
const empty = occupancyOnDay([], [], DAY);
assert.strictEqual(empty.rate, 0, 'нуль номерів — це 0 %, не NaN');
assert.strictEqual(empty.unitDays, 0);
assert.strictEqual(empty.freeUnits, 0);
assert.ok(Number.isFinite(empty.rate), 'NaN у JSON стає null, і число просто зникає з екрана');
// Броня без жодного юніта в фонді теж не має нічого зламати.
assert.strictEqual(occupancyOnDay([], [stay('u1', DAY, '2026-06-17')], DAY).rate, 0);
console.log('  ok  нуль юнітів дає 0 %, а не NaN і не Infinity');

// ── Часткова зайнятість ─────────────────────────────────────────────────────
const three = occupancyOnDay(TEN, [
  stay('u1', DAY, '2026-06-17'),
  stay('u2', '2026-06-14', '2026-06-20'),
  stay('u3', DAY, '2026-06-18', 'checked_in'),
], DAY);
assert.strictEqual(three.occupiedUnits, 3);
assert.strictEqual(three.freeUnits, 7);
assert.strictEqual(three.rate, 30, 'три з десяти — 30 %');
console.log('  ok  часткова зайнятість: 3 з 10 — 30 %, вільних 7');

// Дві броні на одному номері (розділене проживання, зміна гостя) — це один
// зайнятий номер, а не два. Саме тому в SQL стояв COUNT(DISTINCT unit_id).
const doubled = occupancyOnDay(TEN, [
  stay('u1', DAY, '2026-06-17'),
  stay('u1', '2026-06-10', '2026-06-20'),
], DAY);
assert.strictEqual(doubled.occupiedUnits, 1, 'два рядки на один номер — один зайнятий номер');
console.log('  ok  дві броні на одному номері не рахуються двічі');

// ── Сто відсотків ───────────────────────────────────────────────────────────
const full = occupancyOnDay(TEN, TEN.map((u) => stay(u.id, DAY, '2026-06-17')), DAY);
assert.strictEqual(full.rate, 100, 'повний готель — рівно 100 %');
assert.strictEqual(full.freeUnits, 0);
console.log('  ok  повний готель — рівно 100 %, і жодного вільного');

// ── Юніти поза продажем ─────────────────────────────────────────────────────
//
// Це половина розходження з §2.9: звіт рахував знаменник по ВСІХ юнітах.
// Готель на 10 номерів, з них один на ремонті і один pool-юніт «Чорновик»
// (віртуальний, кімнати за ним немає) — продається 10, а рядків 12.
const WITH_DEAD = [
  ...TEN,
  { id: 'u_repair', is_active: 0, is_pool: 0 },
  { id: 'u_pool', is_active: 1, is_pool: 1 },
];
assert.strictEqual(isSellableUnit({ id: 'x', is_active: 1, is_pool: 0 }), true);
assert.strictEqual(isSellableUnit({ id: 'x', is_active: 0, is_pool: 0 }), false, 'номер на ремонті не продається');
assert.strictEqual(isSellableUnit({ id: 'x', is_active: 1, is_pool: 1 }), false, 'pool-юніт — не кімната');
// Відсутня колонка не має вимітати номерний фонд у нуль.
assert.strictEqual(isSellableUnit({ id: 'x' }), true, 'невідоме is_active читається як «активний»');
// Postgres віддає true/false, SQLite 1/0 — обидва мусять читатися однаково.
assert.strictEqual(isSellableUnit({ id: 'x', is_active: true, is_pool: false }), true);
assert.strictEqual(isSellableUnit({ id: 'x', is_active: false, is_pool: false }), false);
assert.strictEqual(isSellableUnit({ id: 'x', is_active: '0' }), false, "рядок '0' — це не істина");

const fullWithDead = occupancy(WITH_DEAD, TEN.map((u) => stay(u.id, DAY, '2026-06-17')), DAY, DAY);
assert.strictEqual(fullWithDead.sellableUnits, 10, 'ремонт і pool у знаменник не входять');
assert.strictEqual(fullWithDead.rate, 100, 'інакше повний готель назавжди застряг би на 83 %');
console.log('  ok  номер на ремонті й pool-юніт не входять у знаменник: повний готель — 100 %');

// Той самий фільтр діє на чисельник. Нерозселена броня лежить на pool-юніті;
// порахувати її зайнятим номером означає видати понад 100 % — тобто число,
// яке не існує, і про яке одразу видно, що система бреше.
const overflow = occupancy(WITH_DEAD, [
  ...TEN.map((u) => stay(u.id, DAY, '2026-06-17')),
  stay('u_pool', DAY, '2026-06-17'),
  stay('u_repair', DAY, '2026-06-17'),
], DAY, DAY);
assert.strictEqual(overflow.occupiedUnitDays, 10, 'броня на pool-юніті чи на знятому номері в чисельник не йде');
assert.ok(overflow.rate <= 100, 'завантаженість понад 100 % неможлива за побудовою, а не обрізанням');
console.log('  ok  броня на pool-юніті не дає 120 %: той самий фільтр на чисельник і знаменник');

// ── Межові статуси ──────────────────────────────────────────────────────────
assert.deepStrictEqual([...OCCUPYING_STATUSES].sort(),
  ['checked_in', 'checked_out', 'confirmed', 'tentative'],
  'набір статусів фіксується тут, щоб він не розʼїхався з day-sheets.repo.ts');

// tentative тримає номер: усі перевірки доступності в проєкті відкидають лише
// cancelled/no_show. Дашборд його не рахував — і показував вільним номер, який
// продати вже не можна.
assert.strictEqual(occupiesUnit('tentative'), true, 'tentative блокує номер, отже він зайнятий');
// checked_out: у звіті за минулий місяць майже всі броні саме такі. Без нього
// звіт за липень показав би близько нуля.
assert.strictEqual(occupiesUnit('checked_out'), true, 'прожита доба була зайнята');
assert.strictEqual(occupiesUnit('confirmed'), true);
assert.strictEqual(occupiesUnit('checked_in'), true);

assert.strictEqual(occupiesUnit('cancelled'), false, 'скасована броня повернула номер у продаж');
// no_show: гість не приїхав, ліжко стояло порожнім. О 00:30 alerts.handlers.ts
// сам переводить прострочені confirmed сюди — якби no_show рахувався зайнятим,
// номер, з якого ніхто не ночував, лишався б «зайнятим» назавжди.
assert.strictEqual(occupiesUnit('no_show'), false, 'ніхто не приїхав — номер був порожній');
assert.strictEqual(occupiesUnit('draft'), false, 'чернетка — ще не броня');
assert.strictEqual(occupiesUnit(null), false, 'відсутній статус не рахується зайнятим');
assert.strictEqual(occupiesUnit('CONFIRMED'), false, 'статуси в базі лише в нижньому регістрі');

const statuses = occupancyOnDay(TEN, [
  stay('u1', DAY, '2026-06-17', 'tentative'),
  stay('u2', DAY, '2026-06-17', 'checked_out'),
  stay('u3', DAY, '2026-06-17', 'cancelled'),
  stay('u4', DAY, '2026-06-17', 'no_show'),
  stay('u5', DAY, '2026-06-17', 'draft'),
], DAY);
assert.strictEqual(statuses.occupiedUnits, 2, 'tentative і checked_out — так; cancelled, no_show, draft — ні');
console.log('  ok  межові статуси: tentative і checked_out рахуються, cancelled/no_show/draft — ні');

// ── Доба виїзду вільна ──────────────────────────────────────────────────────
//
// Номер тримається від заїзду включно до виїзду ВИКЛЮЧНО: у день виїзду його
// вже продають наступному. Помилка на одиницю тут — це номер, який система
// вважає зайнятим у ніч, коли він порожній.
assert.strictEqual(occupancyOnDay(TEN, [stay('u1', '2026-06-15', DAY)], DAY).occupiedUnits, 0,
  'у добу виїзду номер уже вільний');
assert.strictEqual(occupancyOnDay(TEN, [stay('u1', DAY, '2026-06-17')], DAY).occupiedUnits, 1,
  'а в добу заїзду вже зайнятий');
console.log('  ok  доба заїзду зайнята, доба виїзду вільна');

// ── Період: номеро-доби, а не броні ─────────────────────────────────────────
//
// Тиждень у готелі на 10 номерів — це 70 номеро-діб. Одна броня на всі сім
// ночей дає 10 %, а не 100 % за той тиждень.
const week = occupancy(TEN, [stay('u1', '2026-06-15', '2026-06-22')], '2026-06-15', '2026-06-21');
assert.strictEqual(week.days, 7, 'обидва кінці періоду включно');
assert.strictEqual(week.unitDays, 70);
assert.strictEqual(week.occupiedUnitDays, 7);
assert.strictEqual(week.rate, 10);
console.log('  ok  тиждень — це 70 номеро-діб, і одна броня на всі сім ночей це 10 %');

// Проживання, що починається до періоду й закінчується після нього, рахується
// лише тими добами, які в період потрапили.
const straddling = occupancy(TEN, [stay('u1', '2026-06-01', '2026-07-01')], '2026-06-15', '2026-06-21');
assert.strictEqual(straddling.occupiedUnitDays, 7, 'обрізається межами періоду, а не довжиною броні');
console.log('  ok  проживання за межі періоду обрізається періодом');

// Період, введений навиворіт, — помилка вводу, а не привід ділити на нуль.
const inverted = occupancy(TEN, [], '2026-06-21', '2026-06-15');
assert.strictEqual(inverted.days, 1);
assert.strictEqual(inverted.rate, 0);
console.log('  ok  період навиворіт не валить звіт і не ділить на нуль');

// Перехід через межу місяця і року — дати зсуваються в UTC, без таймзони.
assert.strictEqual(occupancy(TEN, [], '2026-12-30', '2027-01-02').days, 4);
assert.strictEqual(occupancy(TEN, [stay('u1', '2026-02-27', '2026-03-02')], '2026-02-27', '2026-03-01').occupiedUnitDays, 3,
  'лютий переходить у березень без загубленої доби');
console.log('  ok  період перетинає місяць і рік без загубленої доби');

// ── Дата з драйвера Postgres ────────────────────────────────────────────────
//
// SQLite віддає дату текстом, драйвер Postgres — обʼєктом Date. Порівняння
// рядка з Date у JS зводить Date до 'Tue Jun 16 2026…' і мовчки дає неправду:
// звіт на Postgres рахував би зовсім не те, що на машині розробника.
const fromPg = occupancyOnDay(TEN, [{
  unit_id: 'u1', status: 'confirmed',
  check_in: new Date(2026, 5, 16, 12, 0, 0),
  check_out: new Date(2026, 5, 18, 12, 0, 0),
}], DAY);
assert.strictEqual(fromPg.occupiedUnits, 1, 'дата з драйвера pg читається так само, як текст із SQLite');
console.log('  ok  дата приходить з обох драйверів і читається однаково');

// ── Те, заради чого все це ──────────────────────────────────────────────────
//
// Дашборд питає про добу, звіт — про період. Це має бути одне число, і саме
// його розходження описане в §2.9. Знімати цю перевірку не можна: щойно вона
// падає, у власника знову два «правильних» відсотки за один день.
const MIXED = [
  stay('u1', DAY, '2026-06-17', 'checked_in'),
  stay('u2', '2026-06-14', '2026-06-20', 'confirmed'),
  stay('u3', DAY, '2026-06-18', 'tentative'),
  stay('u4', '2026-06-15', DAY, 'checked_out'),
  stay('u5', DAY, '2026-06-17', 'cancelled'),
  stay('u_pool', DAY, '2026-06-17', 'draft'),
];
const asDashboard = occupancyOnDay(WITH_DEAD, MIXED, DAY);
const asReport = occupancy(WITH_DEAD, MIXED, DAY, DAY);
assert.strictEqual(asDashboard.rate, asReport.rate,
  'дашборд і звіт за ту саму добу мусять дати те саме число — це і є §2.9');
assert.strictEqual(asDashboard.rate, 30, 'три зайнятих номери з десяти в продажу');
console.log('  ok  дашборд і звіт за ту саму добу дають те саме число');

console.log('occupancy-rate: одна формула завантаженості на дашборд і на звіт');
