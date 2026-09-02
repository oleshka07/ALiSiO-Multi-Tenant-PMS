/**
 * Фініш майстра — не «готово», а звірка Ц8.
 *
 *   node src/modules/channels/domain/reconcile.check.ts
 *
 * За Ц8 ми не бачимо, що готельєр змапив усередині вікна вендора, але список
 * каналів обʼєкта це показує. Тому останній екран майстра каже «N з N
 * тарифів не змаплені на жоден канал», а не «підключено» — інакше людина
 * закриє вікно в переконанні, що продає, і дізнається правду через тиждень
 * порожніх броней. Тариф, змаплений лише на ВИМКНЕНИЙ канал, продається так
 * само нікуди — і названий окремо.
 *
 * Перевірка написана ДО коду і була червоною (інваріант 24).
 */
import assert from 'node:assert';
import { reconcileMappings } from './reconcile.ts';

const pairs = [
  { ratePlanId: 'bar', unitTypeId: 'dbl', remoteId: 'r-bar-dbl' },
  { ratePlanId: 'bar', unitTypeId: 'sgl', remoteId: 'r-bar-sgl' },
  { ratePlanId: 'bb', unitTypeId: 'dbl', remoteId: 'r-bb-dbl' },
];

// ── Нічого не змаплено — три з трьох, і жодного каналу ───────────────────
{
  const r = reconcileMappings(pairs, []);
  assert.strictEqual(r.total, 3);
  assert.strictEqual(r.unmapped.length, 3, 'без каналів кожен тариф не змаплений — і це мусить бути сказано числом');
  assert.strictEqual(r.channels, 0);
  assert.strictEqual(r.sellable, false, 'без жодного змапленого тарифу обʼєкт не продається');
}
console.log('  ok  без каналів: усі не змаплені, обʼєкт не продається');

// ── Один змаплений на активний, один лише на вимкнений, один ніде ────────
{
  const r = reconcileMappings(pairs, [
    { id: 'c1', title: 'Booking', isActive: true, remoteRatePlanIds: ['r-bar-dbl'] },
    { id: 'c2', title: 'Expedia', isActive: false, remoteRatePlanIds: ['r-bar-sgl'] },
  ]);
  assert.strictEqual(r.channels, 2);
  assert.deepStrictEqual(r.unmapped.map((p) => p.remoteId), ['r-bb-dbl'], 'ніде не змаплений — названий');
  assert.deepStrictEqual(r.onlyInactive.map((p) => p.remoteId), ['r-bar-sgl'],
    'змаплений лише на вимкнений канал продається нікуди — і названий ОКРЕМО, бо лікується інакше');
  assert.strictEqual(r.sellable, true, 'хоч один тариф на активному каналі — обʼєкт продається');
}
console.log('  ok  незмаплене і «лише на вимкненому» названі окремо');

// ── Усе змаплено на активні ──────────────────────────────────────────────
{
  const r = reconcileMappings(pairs, [
    { id: 'c1', title: 'Booking', isActive: true, remoteRatePlanIds: ['r-bar-dbl', 'r-bar-sgl', 'r-bb-dbl'] },
  ]);
  assert.strictEqual(r.unmapped.length, 0);
  assert.strictEqual(r.onlyInactive.length, 0);
  assert.strictEqual(r.sellable, true);
}
console.log('  ok  усе змаплено — нуль зауважень');

console.log('reconcile: фініш майстра каже, скільки тарифів продається нікуди, а не «готово»');
