/**
 * Виселення з боргом: що каже політика обʼєкта.
 *
 *   node src/modules/bookings/domain/checkout-balance.check.ts
 *
 * Дві осі (інваріант 26): політика (`none | warning | blocking`) × борг
 * (нуль і додатний). Шість клітинок, і в кожній рішення інше або з іншої
 * причини — саме тому таблиця, а не два твердження. Плюс сам борг: фоліо
 * має перевагу над статусом броні, бо статус — слово, а фоліо — числа.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const {
  checkoutDecision, openBalance, balanceFromReservation, readCheckoutPolicy,
} = await import('./checkout-balance.ts');

// ─── Політика × борг ───────────────────────────────────────────────────────
const table: Array<[string, number, boolean, string | null]> = [
  // policy      balance  allowed  warning
  ['none',       0,       true,    null],
  ['none',       350,     true,    null],
  ['warning',    0,       true,    null],
  ['warning',    350,     true,    'unpaid_balance'],
  ['blocking',   0,       true,    null],
  ['blocking',   350,     false,   null],
];
for (const [policy, balance, allowed, warning] of table) {
  const d = checkoutDecision(policy as any, balance);
  assert.strictEqual(d.allowed, allowed, `${policy} × ${balance}: allowed=${d.allowed}`);
  assert.strictEqual(d.warning, warning, `${policy} × ${balance}: warning=${d.warning}`);
  assert.strictEqual(d.balance, balance);
}
console.log('  ok  шість клітинок політика × борг — кожна своя');

// Борг у копійках — це борг. «Менше гривні — не рахується» тут не пишеться:
// межу дрібного боргу обирав би код, а не готель.
assert.strictEqual(checkoutDecision('blocking', 0.01).allowed, false, 'копійка боргу при blocking — відмова');
// Переплата — не борг.
assert.strictEqual(checkoutDecision('blocking', -120).allowed, true, 'переплата не зупиняє виселення');
console.log('  ok  копійка — борг; переплата — ні');

// ─── Значення політики з бази ──────────────────────────────────────────────
assert.strictEqual(readCheckoutPolicy('none'), 'none');
assert.strictEqual(readCheckoutPolicy('blocking'), 'blocking');
// Порожньо — дефолт колонки (0091), тобто попередження.
assert.strictEqual(readCheckoutPolicy(null), 'warning');
assert.strictEqual(readCheckoutPolicy(undefined), 'warning');
// Невідоме слово — не дозвіл (інваріант 13): читається як найсуворіше.
assert.strictEqual(readCheckoutPolicy('whatever'), 'blocking');
console.log('  ok  порожня політика — попередження, невідома — відмова');

// ─── Сам борг ──────────────────────────────────────────────────────────────
// З фоліо: нараховане мінус оплачене, округлено до копійки. Три рядки з
// різними сумами, дві оплати — щоб сума не вгадувалась з одного числа.
assert.strictEqual(openBalance([1200.5, 350, 89.9], [1000, 200.4]), 440);
assert.strictEqual(openBalance([], []), 0, 'порожнє фоліо — нуль, не NaN');
// 0.1 + 0.2 не дорівнює 0.3 у double — а тут мусить.
assert.strictEqual(openBalance([0.1, 0.2], [0.3]), 0);
console.log('  ok  борг з фоліо — різниця сум, округлена до копійки');

// Без фоліо — зі статусу броні: оплачена бронь боргу не має, будь-яка інша
// винна всю суму. `prepaid` — оплачена (так само читає варта заселення).
assert.strictEqual(balanceFromReservation('paid', 2400), 0);
assert.strictEqual(balanceFromReservation('prepaid', 2400), 0);
assert.strictEqual(balanceFromReservation('unpaid', 2400), 2400);
assert.strictEqual(balanceFromReservation('payment_requested', 2400), 2400);
assert.strictEqual(balanceFromReservation('unpaid', 0), 0, 'безкоштовна бронь без оплати — не борг');
console.log('  ok  без фоліо борг читається зі статусу оплати броні');

console.log('checkout-balance: політика обʼєкта × борг — шість рішень, борг з фоліо або зі статусу');
