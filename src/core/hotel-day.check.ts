/**
 * «Today» is today at the hotel, not on the server.
 *
 *   node src/core/hotel-day.check.ts
 *
 * Every list that means today computed `new Date().toISOString()` — UTC —
 * while `organizations.timezone` sat there, defaulting to Europe/Prague, read
 * by nothing.
 *
 * Prague is UTC+1 in winter and +2 in summer; Kyiv +2/+3. So for the first one
 * to three hours of every local day the server still believed it was
 * yesterday: the arrivals sheet listed the people who came yesterday, the
 * departures sheet chased guests who had already left, occupancy was computed
 * for the wrong date, and the no-show auto-archive — which WRITES — measured
 * against the wrong day.
 *
 * The person this hurt is the night receptionist who starts at midnight, and
 * «the list is wrong for the first hour of the shift» is exactly the kind of
 * thing that gets worked around instead of reported.
 *
 * The assertions below pin the moment that used to be wrong: 23:30 UTC, which
 * is already tomorrow in Prague and in Kyiv.
 */
import assert from 'node:assert';
import { todayIn, shiftDays, shiftMonths, daysBetween, dayString } from './hotel-day.ts';

// 2026-06-15T23:30:00Z — summer, so Prague is UTC+2 and Kyiv UTC+3. Both are
// already on the 16th; UTC is still on the 15th.
const lateEvening = new Date('2026-06-15T23:30:00Z');

assert.strictEqual(todayIn('UTC', lateEvening), '2026-06-15');
assert.strictEqual(todayIn('Europe/Prague', lateEvening), '2026-06-16',
  'Prague was still shown yesterday at half past one in the morning');
assert.strictEqual(todayIn('Europe/Kyiv', lateEvening), '2026-06-16',
  'Kyiv was still shown yesterday at half past two in the morning');
console.log('  ok  о 23:30 UTC у Празі й Києві вже завтра');

// Winter, when Prague is UTC+1: 23:30 UTC is 00:30 in Prague.
const winterEvening = new Date('2026-01-15T23:30:00Z');
assert.strictEqual(todayIn('Europe/Prague', winterEvening), '2026-01-16',
  'the offset changes with the season and the answer has to change with it');
// And an hour earlier it is genuinely still the 15th there.
assert.strictEqual(todayIn('Europe/Prague', new Date('2026-01-15T22:30:00Z')), '2026-01-15');
console.log('  ok  літній і зимовий час дають різні відповіді, і обидві правильні');

// A zone west of UTC goes the other way — the bug was not one-directional.
assert.strictEqual(todayIn('America/New_York', new Date('2026-06-16T02:00:00Z')), '2026-06-15',
  'a negative offset is still yesterday when UTC has rolled over');
console.log('  ok  назад теж: у Нью-Йорку ще вчора, коли в UTC уже завтра');

// An unknown zone must not take the dashboard down.
assert.strictEqual(todayIn('Mars/Olympus', lateEvening), '2026-06-15',
  'an unrecognised timezone falls back to UTC rather than throwing');
assert.strictEqual(todayIn(null, lateEvening), '2026-06-15');
console.log('  ok  невідома таймзона не валить дашборд');

// shiftDays crosses months and years without a timezone of its own.
assert.strictEqual(shiftDays('2026-06-16', 3), '2026-06-19');
assert.strictEqual(shiftDays('2026-06-16', -7), '2026-06-09');
assert.strictEqual(shiftDays('2026-03-01', -1), '2026-02-28');
assert.strictEqual(shiftDays('2026-12-30', 3), '2027-01-02');
assert.strictEqual(shiftDays('2028-03-01', -1), '2028-02-29', 'leap year');
console.log('  ok  зсув днів переходить через місяць, рік і високосний лютий');

// shiftMonths keeps the day of the month where the month has one.
assert.strictEqual(shiftMonths('2026-06-16', 3), '2026-09-16');
assert.strictEqual(shiftMonths('2026-11-30', 1), '2026-12-30');
assert.strictEqual(shiftMonths('2026-12-16', 3), '2027-03-16');
// A day the target month does not have rolls forward, which is what the
// forecast horizon this replaced already did.
assert.strictEqual(shiftMonths('2026-08-31', 3), '2026-12-01');
console.log('  ok  зсув місяців тримає число, а коротший місяць переливається');

// daysBetween decides «overdue», so the sign has to be right.
assert.strictEqual(daysBetween('2026-06-16', '2026-06-16'), 0, 'today is not overdue');
assert.strictEqual(daysBetween('2026-06-16', '2026-06-19'), 3);
assert.strictEqual(daysBetween('2026-06-16', '2026-06-15'), -1, 'yesterday is overdue');
assert.strictEqual(daysBetween('2026-12-30', '2027-01-02'), 3);
// A DST boundary must not turn 24 hours into 23 and lose a day: the
// arithmetic is UTC on purpose.
assert.strictEqual(daysBetween('2026-03-28', '2026-03-30'), 2);
assert.strictEqual(daysBetween('', '2026-06-16'), 0, 'an unknown date is not an urgent one');
console.log('  ok  різниця днів рахує «прострочено» з правильним знаком');

// dayString: SQLite returns the stored text, the Postgres driver a Date.
assert.strictEqual(dayString('2026-06-16'), '2026-06-16');
assert.strictEqual(dayString('2026-06-16T00:00:00.000Z'), '2026-06-16');
assert.strictEqual(dayString(new Date(2026, 5, 16, 12, 0, 0)), '2026-06-16',
  'a Date from the pg driver is read in its own zone, not sliced as text');
assert.strictEqual(dayString(null), '');
console.log('  ok  дата з обох драйверів читається однаково');

console.log('«сьогодні» — це сьогодні в готелі');
