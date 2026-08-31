/**
 * Бронь без призначеного номера видно в планері.
 *
 *   node "src/app/app/(dashboard)/calendar/lanes.check.ts"
 *
 * Ця перевірка написана ДО зміни і мала бути червоною — інваріант 24.
 * Вона й була: `bookingsOfUnit()` віддавав безномерну бронь нікуди, а
 * `freeUnitsOnDate()` рахував її як «нікого не займає». Тобто планер
 * показував би вільним номер, який уже проданий каналом, і рецепція
 * дізналася б про це від гостя на порозі.
 *
 * Що тут стверджується:
 *
 *   1. кожна бронь потрапляє РІВНО в одне місце — у рядок свого номера або
 *      в смугу «без номера». Не в обидва і не в жодне;
 *   2. лічильник вільних відбирає й безномерні броні;
 *   3. півінтервал [заїзд, виїзд) діє однаково для обох видів: у день
 *      виїзду номер знову продається.
 */
import assert from 'node:assert';
import {
  bookingsOfUnit, unassignedBookings, freeUnitsOnDate, packLanes,
  type LaneBooking, type LaneBlock,
} from './lanes.ts';

const units = ['u1', 'u2', 'u3'];

const bookings: LaneBooking[] = [
  { id: 'b1', unit_id: 'u1', check_in: '2026-09-10', check_out: '2026-09-12' },
  // Прийшла з каналу: тип відомий, кімната ні.
  { id: 'b2', unit_id: null, check_in: '2026-09-10', check_out: '2026-09-11' },
  { id: 'b3', unit_id: null, check_in: '2026-09-11', check_out: '2026-09-13' },
];
const blocks: LaneBlock[] = [
  { unit_id: 'u3', date_from: '2026-09-12', date_to: '2026-09-13' },
];

// ─── 1. Кожна бронь — рівно в одному місці ──────────────────────────────────
const placed = new Map<string, number>();
for (const u of units) for (const b of bookingsOfUnit(bookings, u)) {
  placed.set(b.id, (placed.get(b.id) ?? 0) + 1);
}
for (const b of unassignedBookings(bookings)) {
  placed.set(b.id, (placed.get(b.id) ?? 0) + 1);
}

for (const b of bookings) {
  assert.strictEqual(placed.get(b.id), 1,
    `бронь ${b.id} потрапила в ${placed.get(b.id) ?? 0} місць, а мала рівно в одне`);
}
console.log('  ok  кожна бронь лягає рівно в одне місце — рядок номера або смуга «без номера»');

// Смуга містить саме безномерні, і нічого крім них.
assert.deepStrictEqual(unassignedBookings(bookings).map(b => b.id), ['b2', 'b3']);
// А рядок номера не показує чужого.
assert.deepStrictEqual(bookingsOfUnit(bookings, 'u1').map(b => b.id), ['b1']);
assert.deepStrictEqual(bookingsOfUnit(bookings, 'u2').map(b => b.id), []);
console.log('  ok  смуга не забирає чужих броней, рядок номера не показує безномерних');

// ─── 2. Лічильник вільних ───────────────────────────────────────────────────
//
// 10-те: u1 зайнятий бронню, плюс одна безномерна (b2) → вільний один із трьох.
assert.strictEqual(freeUnitsOnDate(bookings, blocks, units, '2026-09-10'), 1,
  '10-те: три номери, один зайнятий поіменно, один проданий без кімнати');

// 11-те: u1 ще зайнятий (виїзд 12-го), b2 закінчилась, b3 почалась → знову один.
assert.strictEqual(freeUnitsOnDate(bookings, blocks, units, '2026-09-11'), 1,
  '11-те: b2 виїхала, b3 заїхала — кількість та сама');

// 12-те: u1 звільнився, u3 у ремонті, b3 ще триває → вільний один (u2).
assert.strictEqual(freeUnitsOnDate(bookings, blocks, units, '2026-09-12'), 1,
  '12-те: номер, що звільнився в день виїзду, мусить рахуватись вільним');

// 13-те: усе закінчилось → три вільні.
assert.strictEqual(freeUnitsOnDate(bookings, blocks, units, '2026-09-13'), 3,
  '13-те: усе виїхало й ремонт скінчився');
console.log('  ok  вільних менше рівно на стільки, скільки продано без кімнати');

// ─── 3. Тиск понад фонд не дає відʼємного ───────────────────────────────────
const crowd: LaneBooking[] = [
  { id: 'c1', unit_id: null, check_in: '2026-09-10', check_out: '2026-09-11' },
  { id: 'c2', unit_id: null, check_in: '2026-09-10', check_out: '2026-09-11' },
  { id: 'c3', unit_id: null, check_in: '2026-09-10', check_out: '2026-09-11' },
  { id: 'c4', unit_id: null, check_in: '2026-09-10', check_out: '2026-09-11' },
];
assert.strictEqual(freeUnitsOnDate(crowd, [], units, '2026-09-10'), 0,
  'чотири безномерні на три номери — нуль, а не мінус один');
console.log('  ok  переповнення дає нуль, а не відʼємне число в шапці планера');

// ─── 4. Порожні входи ───────────────────────────────────────────────────────
assert.deepStrictEqual(unassignedBookings([]), []);
assert.strictEqual(freeUnitsOnDate([], [], units, '2026-09-10'), 3);
assert.strictEqual(freeUnitsOnDate(bookings, blocks, [], '2026-09-10'), 0,
  'немає номерів — немає й вільних, а не відʼємне від тиску');
console.log('  ok  порожні входи не ламають лічильник');

// ─── 5. Смуга не ховає броней одна за одною ─────────────────────────────────
//
// З каналу цілком нормально приходять дві броні на ті самі дати: вони на
// різні кімнати одного типу, просто ще не сказано які. В одному підрядку
// вони намалювались би одна поверх одної — смуга показала б одну замість
// двох, і виглядало б це як правда.
const overlapping: LaneBooking[] = [
  { id: 'o1', unit_id: null, check_in: '2026-09-10', check_out: '2026-09-13' },
  { id: 'o2', unit_id: null, check_in: '2026-09-11', check_out: '2026-09-14' },
  { id: 'o3', unit_id: null, check_in: '2026-09-12', check_out: '2026-09-15' },
];
const packed = packLanes(overlapping);
assert.strictEqual(packed.length, 3, 'три взаємно перетинні броні мали лягти в три підрядки');

// Жодного перетину ВСЕРЕДИНІ підрядка — це і є вся вимога.
for (const row of packed) {
  const sorted = [...row].sort((a, b) => a.check_in.localeCompare(b.check_in));
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].check_in >= sorted[i - 1].check_out,
      `у підрядку перетнулись ${sorted[i - 1].id} і ${sorted[i].id}`);
  }
}

// Жодна бронь не загубилась і не роздвоїлась.
assert.deepStrictEqual(
  packed.flat().map(b => b.id).sort(), ['o1', 'o2', 'o3'],
  'розкладання втратило або продублювало бронь');

// Півінтервал діє й тут: виїзд 12-го і заїзд 12-го вміщаються в один підрядок.
const touching: LaneBooking[] = [
  { id: 't1', unit_id: null, check_in: '2026-09-10', check_out: '2026-09-12' },
  { id: 't2', unit_id: null, check_in: '2026-09-12', check_out: '2026-09-14' },
];
assert.strictEqual(packLanes(touching).length, 1,
  'бронь, що виїжджає в день заїзду наступної, мала лягти в той самий підрядок');

assert.deepStrictEqual(packLanes([]), [], 'порожній список — жодного підрядка');
console.log('  ok  смуга розкладає перетинні броні по підрядках і нічого не ховає');

console.log('планер: бронь без номера видно, і вона зменшує вільне');
