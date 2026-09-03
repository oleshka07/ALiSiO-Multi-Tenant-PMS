/**
 * Опис різниці двох знімків броні — те, що читає картка і що пише канал.
 *
 *   node src/modules/bookings/domain/booking-history.check.ts
 *
 * Дві осі (інваріант 26): поле, що змінилось, названо з обома значеннями;
 * поле, що не змінилось, не названо. Знімок без поля не вигадує «— → —».
 */
import assert from 'node:assert';
import { describeChanges, changesToText } from './booking-history.ts';

const before = {
  check_in: '2026-12-07', check_out: '2026-12-10', nights: 3, adults: 2, children: 0,
  total_price: 420, currency: 'USD', status: 'confirmed', payment_status: 'unpaid',
  unit_type_name: 'Twin Room', unit_code: 'T2', guest_name: 'Jana Nová',
};
const after = {
  ...before, check_out: '2026-12-11', nights: 4, total_price: 560,
  unit_type_name: 'Double Room', unit_code: null, guest_name: 'Jana Nováková',
};

const lines = describeChanges(before, after);
assert.deepStrictEqual(lines.map((l) => l.field), ['dates', 'nights', 'price', 'unit_type', 'unit', 'guest'],
  `названо не те: ${JSON.stringify(lines.map((l) => l.field))}`);
assert.deepStrictEqual(lines[0], { field: 'dates', label: 'Дати', from: '2026-12-07 → 2026-12-10', to: '2026-12-07 → 2026-12-11' });
assert.deepStrictEqual(lines[2], { field: 'price', label: 'Сума', from: '420 USD', to: '560 USD' });
assert.deepStrictEqual(lines[4], { field: 'unit', label: 'Номер', from: 'T2', to: '—' }, 'знята кімната показується тире, не порожнім');
assert.ok(!lines.some((l) => l.field === 'guests' || l.field === 'status' || l.field === 'payment'),
  'гості, статус і оплата не змінились — і не названі');
console.log('  ok  змінене названо з обома значеннями, незмінене мовчить');

// Знімок із датами як Date (Postgres) читається так само, як рядок (SQLite).
const pg = describeChanges({ check_in: new Date('2026-12-07T00:00:00Z'), check_out: new Date('2026-12-10T00:00:00Z') }, { check_in: '2026-12-07', check_out: '2026-12-11' });
assert.deepStrictEqual(pg.map((l) => [l.from, l.to]), [['2026-12-07 → 2026-12-10', '2026-12-07 → 2026-12-11']]);
console.log('  ok  Date і рядок дають один і той самий підпис дат');

assert.strictEqual(describeChanges(null, null).length, 0, 'два порожні знімки — жодного рядка');
assert.strictEqual(changesToText(lines.slice(0, 2)), 'Дати: 2026-12-07 → 2026-12-10 → 2026-12-07 → 2026-12-11; Ночей: 3 → 4');
console.log('  ok  порожнє мовчить, текст журналу складається з тих самих рядків');

console.log('booking-history: різниця знімків — змінене названо, незмінене мовчить');
