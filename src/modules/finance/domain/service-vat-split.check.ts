/**
 * Поділ послуги на податкові компоненти.
 *
 *   node src/modules/finance/domain/service-vat-split.check.ts
 *
 * Числа — пілотні (сніданок 12+3, Lunchpaket 70/30), твердження — загальні:
 * рядки завжди сходяться в суму замовлення, битий JSON — не помилка, а
 * «поділу немає».
 */
import assert from 'node:assert';
import { parseVatSplit, splitCharge } from './service-vat-split.ts';

const BREAKFAST = parseVatSplit(JSON.stringify([
  { label: 'Speisen', amount: 12, vatCode: 'reduced' },
  { label: 'Getränke', amount: 3, vatCode: 'standard' },
]))!;
assert.ok(BREAKFAST, 'валідний поділ парситься');

// ─── Каталожна ціна: 15 € → 12 + 3 ──────────────────────────────────────────
let lines = splitCharge(BREAKFAST, 15, 1);
assert.deepStrictEqual(lines.map((l) => [l.label, l.vatCode, l.totalGross]),
  [['Speisen', 'reduced', 12], ['Getränke', 'standard', 3]]);
console.log('  ok  сніданок 15 → Speisen 12 (7%) + Getränke 3 (19%)');

// ─── Кількість: 2 сніданки → 24 + 6 ────────────────────────────────────────
lines = splitCharge(BREAKFAST, 15, 2);
assert.deepStrictEqual(lines.map((l) => l.totalGross), [24, 6]);
assert.strictEqual(lines[0].unitGross, 12);
console.log('  ok  ×2 → 24 + 6, ціна за одиницю не пливе');

// ─── Змінена рецепцією ціна масштабується, копійка — на останній ───────────
lines = splitCharge(BREAKFAST, 10, 1); // знижка: 15 → 10
assert.strictEqual(lines[0].totalGross + lines[1].totalGross, 10, 'рядки сходяться в суму замовлення');
assert.strictEqual(lines[0].totalGross, 8, '12/15 від 10');
assert.strictEqual(lines[1].totalGross, 2);
lines = splitCharge(BREAKFAST, 9.99, 3);
assert.strictEqual(lines.reduce((s, l) => s + l.totalGross, 0), 29.97, 'непарні копійки не губляться');
console.log('  ok  нестандартна ціна: пропорція + залишок на останній компонент');

// ─── Lunchpaket 70/30 ──────────────────────────────────────────────────────
const LUNCH = parseVatSplit([{ label: 'Speisen', amount: 5.6, vatCode: 'reduced' },
  { label: 'Getränke', amount: 2.4, vatCode: 'standard' }])!;
lines = splitCharge(LUNCH, 8, 1);
assert.deepStrictEqual(lines.map((l) => l.totalGross), [5.6, 2.4]);
console.log('  ok  Lunchpaket 8 → 5,60 + 2,40');

// ─── Сміття — це «поділу немає», а не крах проводки ────────────────────────
for (const bad of [null, '', 'not json', '[]', '[{"label":"x"}]',
  JSON.stringify([{ label: 'a', amount: 5, vatCode: 'reduced' }]), // один компонент — не поділ
  JSON.stringify([{ label: '', amount: 5, vatCode: 'reduced' }, { label: 'b', amount: 1, vatCode: 'standard' }]),
  JSON.stringify([{ label: 'a', amount: -5, vatCode: 'reduced' }, { label: 'b', amount: 1, vatCode: 'standard' }])]) {
  assert.strictEqual(parseVatSplit(bad), null, `відхилено: ${String(bad).slice(0, 40)}`);
}
console.log('  ok  битий/неповний поділ → null, послуга йде одним рядком як досі');

console.log('service-vat-split: гість бачить одну ціну, бухгалтерія — свої ставки');
