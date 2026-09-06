/**
 * Перетягування в планері: бронь лягає туди, куди її кинули, зберігає ночі,
 * і не лягає на зайняте чи закрите.
 *
 *   node "src/app/app/(dashboard)/calendar/drag.check.ts"
 *
 * Написано ДО коду (інваріант 24). Осі (інваріант 26): дві броні різної
 * довжини, дві кімнати різних типів, блокування на одній з них.
 */
import assert from 'node:assert';
import {
  shiftDate, daysBetween, dropTarget, isSamePlace, localConflict, moveKind, isMovable,
} from './drag.ts';
import type { LaneBooking, LaneBlock } from './lanes.ts';

// ─── дати ──────────────────────────────────────────────────────────────────
assert.strictEqual(shiftDate('2026-10-30', 3), '2026-11-02', 'через межу місяця');
assert.strictEqual(shiftDate('2026-03-29', 1), '2026-03-30', 'переведення годинника не зсуває день');
assert.strictEqual(shiftDate('2026-01-01', -1), '2025-12-31', 'назад через рік');
assert.strictEqual(daysBetween('2026-10-09', '2026-10-11'), 2);
console.log('  ok  дати зсуваються по календарю, а не по годиннику');

// ─── ціль ──────────────────────────────────────────────────────────────────
const two: LaneBooking = { id: 'b2', unit_id: 'u1', check_in: '2026-10-09', check_out: '2026-10-11' };
const five: LaneBooking = { id: 'b5', unit_id: 'u2', check_in: '2026-10-20', check_out: '2026-10-25' };

// Взяли за перший день, кинули на 12-те в u2 → 12–14, дві ночі.
assert.deepStrictEqual(dropTarget(two, 'u2', '2026-10-12', 0),
  { unit_id: 'u2', check_in: '2026-10-12', check_out: '2026-10-14', nights: 2 });
// Взяли за третій день пʼятиденної, кинули на 22-ге → заїзд 20-го: бронь не зсунулась.
assert.deepStrictEqual(dropTarget(five, 'u2', '2026-10-22', 2),
  { unit_id: 'u2', check_in: '2026-10-20', check_out: '2026-10-25', nights: 5 });
assert.ok(isSamePlace(five, dropTarget(five, 'u2', '2026-10-22', 2)), 'кинули туди ж — нема що зберігати');
assert.ok(!isSamePlace(five, dropTarget(five, 'u1', '2026-10-22', 2)), 'інша кімната — є що зберігати');
console.log('  ok  ціль тримає кількість ночей і враховує, за який день узяли смугу');

// ─── конфлікти з того, що вже на екрані ────────────────────────────────────
const bookings: LaneBooking[] = [two, five, { id: 'bx', unit_id: 'u1', check_in: '2026-10-11', check_out: '2026-10-13' }];
const blocks: LaneBlock[] = [{ unit_id: 'u2', date_from: '2026-10-14', date_to: '2026-10-16' }];

// two → u1 на 11-те: bx стоїть 11–13 → конфлікт із bx (сама two виключена).
assert.deepStrictEqual(localConflict(bookings, blocks, dropTarget(two, 'u1', '2026-10-11', 0), 'b2'), { kind: 'booking', id: 'bx' });
// two → u1 на 13-те: bx виїжджає 13-го — півінтервал, вільно.
assert.strictEqual(localConflict(bookings, blocks, dropTarget(two, 'u1', '2026-10-13', 0), 'b2'), null);
// two → u2 на 13-те: 13–15 накриває блокування 14–16.
assert.deepStrictEqual(localConflict(bookings, blocks, dropTarget(two, 'u2', '2026-10-13', 0), 'b2'),
  { kind: 'block', unit_id: 'u2', date_from: '2026-10-14', date_to: '2026-10-16' });
// two → u2 на 12-те: 12–14, блокування починається 14-го — вільно.
assert.strictEqual(localConflict(bookings, blocks, dropTarget(two, 'u2', '2026-10-12', 0), 'b2'), null);
// Своє місце не конфліктує саме з собою.
assert.strictEqual(localConflict(bookings, blocks, dropTarget(two, 'u1', '2026-10-09', 0), 'b2'), null);
console.log('  ok  конфлікт видно з броней і блокувань, півінтервал, своя бронь не заважає собі');

// ─── що це за хід ──────────────────────────────────────────────────────────
assert.strictEqual(moveKind({ unit_id: 'u1', unit_type_id: 'dbl' }, { unit_id: 'u1', unit_type_id: 'dbl' }), 'same_unit');
assert.strictEqual(moveKind({ unit_id: 'u1', unit_type_id: 'dbl' }, { unit_id: 'u2', unit_type_id: 'dbl' }), 'same_type');
assert.strictEqual(moveKind({ unit_id: 'u1', unit_type_id: 'dbl' }, { unit_id: 'u3', unit_type_id: 'suite' }), 'other_type');
assert.strictEqual(moveKind({ unit_id: null, unit_type_id: 'dbl' }, { unit_id: 'u3', unit_type_id: 'suite' }), 'assign');
assert.strictEqual(moveKind({ unit_id: 'u1', unit_type_id: null }, { unit_id: 'u2', unit_type_id: 'dbl' }), 'other_type', 'невідомий тип — питаємо, а не мовчимо');
assert.ok(isMovable('confirmed') && isMovable('checked_in') && isMovable('tentative'));
assert.ok(!isMovable('checked_out') && !isMovable('cancelled') && !isMovable('no_show'));
console.log('  ok  інший тип — підтвердження; безномерна — призначення; виселена не рухається');

console.log('drag: бронь лягає куди кинули, ночі ті самі, зайняте й закрите не приймає');
