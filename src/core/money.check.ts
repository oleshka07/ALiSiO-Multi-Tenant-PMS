/**
 * Money rounding.
 *
 *   node src/core/money.check.ts
 *
 * The cases below are the ones that were actually producing stored tails:
 * a commission, a currency conversion, and a long run of additions.
 */
import assert from 'node:assert';
import { money, sumMoney, percentOf, splitMoney } from './money.ts';

// The commission that started this: 2870.55 * 0.15 is 430.58250000000004.
assert.strictEqual(percentOf(2870.55, 15), 430.58);
assert.notStrictEqual(2870.55 * 0.15, 430.58);
console.log('  ok  a commission is stored to the heller, not to the tail');

// Ties round away from zero, not towards +Infinity.
assert.strictEqual(money(0.005), 0.01);
assert.strictEqual(money(-0.005), -0.01);
assert.strictEqual(money(2.675), 2.68, '2.675 is 2.67499999999999982 as a double');
assert.strictEqual(money(1.005), 1.01, '1.005 * 100 is 100.49999999999999');
console.log('  ok  halves round away from zero, through the decimal shift');

// -0 is not a money amount.
assert.ok(Object.is(money(-0.001), 0));
console.log('  ok  a rounded-away negative is zero, not minus zero');

// A long run of additions rounds once, at the end.
const tenth = new Array(1000).fill(0.1);
assert.notStrictEqual(tenth.reduce((a, b) => a + b, 0), 100);
assert.strictEqual(sumMoney(tenth), 100);
console.log('  ok  a thousand additions still add up');

// A currency conversion.
assert.strictEqual(money(199.99 * 24.21), 4841.76, '199.99 * 24.21 = 4841.7579');
console.log('  ok  a conversion lands on a real amount');

// Splitting keeps the total.
for (const [total, parts] of [[100, 3], [0.05, 3], [1234.57, 7], [-10, 4]] as const) {
  const split = splitMoney(total, parts);
  assert.strictEqual(split.length, parts);
  assert.strictEqual(sumMoney(split), money(total), `split ${total}/${parts} lost money`);
}
assert.deepStrictEqual(splitMoney(100, 3), [33.34, 33.33, 33.33]);
console.log('  ok  a split adds back up to what was split');

// Nonsense in, zero out — a NaN amount must not reach a money column.
assert.strictEqual(money(NaN), 0);
assert.strictEqual(money(Infinity), 0);
assert.strictEqual(sumMoney([1.5, NaN, 2.5]), 4);
console.log('  ok  NaN and Infinity never become an amount');

console.log('money: all checks passed');
